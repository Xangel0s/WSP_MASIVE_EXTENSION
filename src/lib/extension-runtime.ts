type RuntimeMessageHandler = (
  message: unknown,
  sender: unknown,
  sendResponse: (response?: unknown) => void
) => void;

interface RuntimeLike {
  id?: string;
  lastError?: { message?: string };
  sendMessage: (payload: unknown, callback: (response: unknown) => void) => void;
  onMessage?: {
    addListener: (handler: RuntimeMessageHandler) => void;
    removeListener: (handler: RuntimeMessageHandler) => void;
  };
}

interface ChromeLike {
  runtime?: RuntimeLike;
}

const getChromeRuntime = (): RuntimeLike | null =>
  (globalThis as { chrome?: ChromeLike }).chrome?.runtime ?? null;

export const hasExtensionRuntime = () => Boolean(getChromeRuntime()?.id);

export const sendRuntimeMessage = <T = unknown>(payload: unknown): Promise<T> =>
  new Promise((resolve, reject) => {
    const runtime = getChromeRuntime();
    if (!runtime) {
      reject(new Error("No hay runtime de extensión disponible"));
      return;
    }

    runtime.sendMessage(payload, (response: T) => {
      const lastError = getChromeRuntime()?.lastError;
      if (lastError) {
        reject(new Error(lastError.message || "Error enviando mensaje al background"));
        return;
      }
      resolve(response);
    });
  });

export const subscribeRuntimeMessages = (handler: RuntimeMessageHandler) => {
  const runtime = getChromeRuntime();
  if (!runtime?.onMessage) {
    return () => {};
  }

  runtime.onMessage.addListener(handler);
  return () => {
    runtime.onMessage.removeListener(handler);
  };
};
