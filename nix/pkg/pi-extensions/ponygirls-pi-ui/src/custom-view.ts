import type { Component, TUI } from "@earendil-works/pi-tui";

type CustomComponent = Component & { dispose?(): void };
export type CustomViewFactory<Theme, Keys> = (tui: TUI, theme: Theme, keys: Keys, done: () => void) => CustomComponent | Promise<CustomComponent>;
export interface CustomViewUI<Theme, Keys> {
  custom<T>(factory: (tui: TUI, theme: Theme, keys: Keys, done: (value: T) => void) => CustomComponent | Promise<CustomComponent>, options?: { retainEditorBorders?: boolean; overlay?: boolean }): Promise<T>;
}

interface Interaction {
  closing: boolean;
  done: (() => void) | null;
  dispose: (() => void) | null;
}

/** One session's command/badge view. Dispose permanently revokes retained callbacks. */
export class CustomViewToggle {
  private interaction: Interaction | null = null;
  private disposed = false;

  get isDisposed(): boolean { return this.disposed; }

  async toggle<Theme, Keys>(ui: CustomViewUI<Theme, Keys>, factory: CustomViewFactory<Theme, Keys>): Promise<void> {
    if (this.interaction !== null) {
      this.close(this.interaction);
      return;
    }
    await this.open(ui, factory);
  }

  async open<Theme, Keys>(ui: CustomViewUI<Theme, Keys>, factory: CustomViewFactory<Theme, Keys>): Promise<void> {
    if (this.disposed || this.interaction !== null) return;
    const interaction: Interaction = { closing: false, done: null, dispose: null };
    this.interaction = interaction;
    try {
      await ui.custom<void>((tui, theme, keys, done) => {
        interaction.done = done;
        if (interaction.closing) {
          done();
          return { render: () => [], invalidate() {} };
        }
        const finish = () => this.close(interaction);
        const result = factory(tui, theme, keys, finish);
        const retain = (component: CustomComponent): CustomComponent => {
          // Pi can discard a result closed before mounting, without disposing it.
          const originalDispose = component.dispose?.bind(component);
          let disposed = false;
          const dispose = () => {
            if (disposed) return;
            disposed = true;
            originalDispose?.();
          };
          component.dispose = dispose;
          interaction.dispose = dispose;
          if (interaction.closing) dispose();
          return component;
        };
        return result instanceof Promise ? result.then(retain) : retain(result);
      }, { retainEditorBorders: true });
    } finally {
      if (this.interaction === interaction) this.interaction = null;
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.interaction !== null) this.close(this.interaction);
  }

  private close(interaction: Interaction): void {
    if (interaction.closing) return;
    interaction.closing = true;
    try { interaction.done?.(); } finally { interaction.dispose?.(); }
  }
}
