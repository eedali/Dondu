import type { AIClassifyOutput, Plan } from '@shared/types'

/** AI step (phase 3). Until providers exist this returns no results. */
export async function runAiForSession(
  _sessionId: string,
  _signal: AbortSignal,
  _onProgress: (done: number, total: number) => void,
): Promise<{ results: Map<string, AIClassifyOutput>; summary: Plan['summary']['ai'] }> {
  return { results: new Map(), summary: undefined }
}
