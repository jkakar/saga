import type { ExecutorPlugin } from "./types";

export class PluginRegistry<T extends ExecutorPlugin> {
  private plugins = new Map<string, T>();

  register(plugin: T): void {
    this.plugins.set(plugin.type, plugin);
  }

  lookup(type: string): T | undefined {
    return this.plugins.get(type);
  }
}
