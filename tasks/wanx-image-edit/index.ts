import type { Context } from "@oomol/types/oocana";

//#region generated meta
type Inputs = {
  prompt: string;
  imageURLs: string[];
  model: "wan2.6-image" | null;
  negativePrompt: string | null;
  size: string | null;
  n: number | null;
  promptExtend: boolean | null;
  watermark: boolean | null;
  seed: number | null;
};
type Outputs = {
  images: string[];
  taskId: string;
};
//#endregion

interface SubmitResponse {
  success: boolean;
  sessionID: string;
}

interface StateResponse {
  success: boolean;
  state: "processing" | "completed" | "failed";
  progress: number;
}

interface ResultResponse {
  success: boolean;
  state: string;
  data: {
    taskId: string;
    images: string[];
  };
}

const BASE_URL = "https://fusion-api.oomol.com/v1/wanx-image";
const POLL_INTERVAL = 2000; // 2 seconds

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default async function (
  params: Inputs,
  context: Context<Inputs, Outputs>
): Promise<Outputs> {
  // Get OOMOL token
  const token = await context.getOomolToken();

  // Validate inputs
  if (!params.prompt || params.prompt.length === 0) {
    throw new Error("Prompt is required");
  }
  if (params.prompt.length > 2000) {
    throw new Error("Prompt must be 2000 characters or less");
  }
  if (!params.imageURLs || params.imageURLs.length === 0) {
    throw new Error("At least one image URL is required");
  }
  if (params.imageURLs.length > 4) {
    throw new Error("Maximum 4 image URLs allowed");
  }

  // Prepare request body
  const requestBody: Record<string, unknown> = {
    model: params.model || "wan2.6-image",
    prompt: params.prompt,
    imageURLs: params.imageURLs,
    n: params.n || 4,
    promptExtend: params.promptExtend !== undefined ? params.promptExtend : true,
    watermark: params.watermark || false,
  };

  if (params.negativePrompt) {
    requestBody.negativePrompt = params.negativePrompt;
  }
  if (params.size) {
    requestBody.size = params.size;
  }
  if (params.seed) {
    requestBody.seed = params.seed;
  }

  // Step 1: Submit task
  context.reportProgress(10);
  const submitResponse = await fetch(`${BASE_URL}/submit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!submitResponse.ok) {
    const errorText = await submitResponse.text();
    throw new Error(
      `Failed to submit task: ${submitResponse.status} ${submitResponse.statusText} - ${errorText}`
    );
  }

  const submitData: SubmitResponse = await submitResponse.json();
  if (!submitData.success || !submitData.sessionID) {
    throw new Error("Failed to get session ID from submit response");
  }

  const sessionID = submitData.sessionID;
  context.reportProgress(20);

  // Step 2: Poll for task completion
  let state: StateResponse;
  let attempts = 0;
  const maxAttempts = 300; // 10 minutes max (300 * 2 seconds)

  while (attempts < maxAttempts) {
    await sleep(POLL_INTERVAL);
    attempts++;

    const stateResponse = await fetch(`${BASE_URL}/state/${sessionID}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!stateResponse.ok) {
      const errorText = await stateResponse.text();
      throw new Error(
        `Failed to get task state: ${stateResponse.status} ${stateResponse.statusText} - ${errorText}`
      );
    }

    state = await stateResponse.json();

    if (!state.success) {
      throw new Error("Task state check failed");
    }

    // Update progress (20% to 90% based on API progress)
    const progressPercent = 20 + Math.floor((state.progress / 100) * 70);
    context.reportProgress(progressPercent);

    if (state.state === "completed") {
      break;
    }

    if (state.state === "failed") {
      throw new Error("Image editing task failed");
    }
  }

  if (attempts >= maxAttempts) {
    throw new Error("Task timeout: exceeded maximum wait time");
  }

  context.reportProgress(95);

  // Step 3: Get result
  const resultResponse = await fetch(`${BASE_URL}/result/${sessionID}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!resultResponse.ok) {
    const errorText = await resultResponse.text();
    throw new Error(
      `Failed to get task result: ${resultResponse.status} ${resultResponse.statusText} - ${errorText}`
    );
  }

  const resultData: ResultResponse = await resultResponse.json();

  if (!resultData.success || !resultData.data) {
    throw new Error("Failed to get result data");
  }

  context.reportProgress(100);

  return {
    images: resultData.data.images,
    taskId: resultData.data.taskId,
  };
}
