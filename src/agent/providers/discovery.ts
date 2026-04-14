import type { AppConfig } from "../../app/config";
import { childLogger } from "../../app/logger";

export type DiscoveredModel = {
  name: string;
  size?: number;
  modifiedAt?: string;
  digest?: string;
};

export type ModelDiscovery = {
  start(): Promise<void>;
  stop(): void;
  listAvailable(): Promise<DiscoveredModel[]>;
  getActive(): DiscoveredModel | null;
  setActive(modelName: string): Promise<void>;
  getFallbackChain(): DiscoveredModel[];
  setFallbackChain(modelNames: string[]): Promise<void>;
};

type OllamaTagsResponse = {
  models: Array<{
    name: string;
    size?: number;
    modified_at?: string;
    digest?: string;
  }>;
};

const log = childLogger("model-discovery");

/**
 * Creates a ModelDiscovery instance that polls the Ollama /api/tags endpoint.
 * Active model and fallback chain are persisted via the settings store
 * (injected lazily to avoid circular dependencies during bootstrap).
 */
export function createModelDiscovery(
  config: AppConfig["models"],
  getSettings?: () => { get(key: string): string | null; set(key: string, value: string): void }
): ModelDiscovery {
  let available: DiscoveredModel[] = [];
  let activeModel: DiscoveredModel | null = null;
  let fallbackChain: DiscoveredModel[] = [];
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  async function poll(): Promise<void> {
    try {
      const res = await fetch(`${config.baseUrl}/api/tags`);
      if (!res.ok) {
        log.warn({ status: res.status }, "Failed to fetch Ollama model list");
        return;
      }
      const data = (await res.json()) as OllamaTagsResponse;
      available = (data.models ?? []).map((m) => ({
        name: m.name,
        size: m.size,
        modifiedAt: m.modified_at,
        digest: m.digest,
      }));
      log.debug({ count: available.length }, "Discovered models");

      // Validate active model still exists
      if (activeModel && !available.some((m) => m.name === activeModel!.name)) {
        log.warn({ model: activeModel.name }, "Active model no longer available — attempting fallback");
        selectFallback();
      }

      // Initial selection if none set yet
      if (!activeModel) {
        selectInitialModel();
      }
    } catch (err) {
      log.error({ err }, "Error polling Ollama model list");
    }
  }

  function selectInitialModel(): void {
    // Prefer config.model, then first available
    const preferred = config.model
      ? available.find((m) => m.name === config.model)
      : null;
    const selected = preferred ?? available[0] ?? null;
    if (selected) {
      activeModel = selected;
      log.info({ model: selected.name }, "Selected initial model");
    }

    // Set fallback chain from config
    if (fallbackChain.length === 0 && config.fallbackModels.length > 0) {
      fallbackChain = config.fallbackModels
        .map((name) => available.find((m) => m.name === name))
        .filter((m): m is DiscoveredModel => m !== undefined);
    }
  }

  function selectFallback(): void {
    const next = fallbackChain.find((m) =>
      available.some((a) => a.name === m.name)
    );
    if (next) {
      activeModel = next;
      log.info({ model: next.name }, "Fell back to model");
    } else if (available.length > 0) {
      activeModel = available[0]!;
      log.warn({ model: activeModel.name }, "No configured fallback available — using first available model");
    } else {
      activeModel = null;
      log.error("No models available");
    }
  }

  return {
    async start(): Promise<void> {
      if (!config.discovery.enabled) {
        log.info("Model discovery disabled");
        return;
      }
      await poll();
      pollTimer = setInterval(
        () => void poll(),
        config.discovery.pollIntervalSeconds * 1000
      );
    },

    stop(): void {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    },

    async listAvailable(): Promise<DiscoveredModel[]> {
      // Trigger a fresh poll before returning
      await poll();
      return available;
    },

    getActive(): DiscoveredModel | null {
      return activeModel;
    },

    async setActive(modelName: string): Promise<void> {
      const model = available.find((m) => m.name === modelName);
      if (!model) throw new Error(`Model "${modelName}" not found in available list`);
      activeModel = model;
      getSettings?.().set("model.active", modelName);
      log.info({ model: modelName }, "Active model changed");
    },

    getFallbackChain(): DiscoveredModel[] {
      return fallbackChain;
    },

    async setFallbackChain(modelNames: string[]): Promise<void> {
      fallbackChain = modelNames
        .map((name) => available.find((m) => m.name === name))
        .filter((m): m is DiscoveredModel => m !== undefined);
      getSettings?.().set("model.fallbacks", JSON.stringify(modelNames));
      log.info({ chain: modelNames }, "Fallback chain updated");
    },
  };
}
