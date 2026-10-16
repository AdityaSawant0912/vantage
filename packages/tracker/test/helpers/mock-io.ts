/** Minimal IntersectionObserver stand-in; tests drive it with `fire`. */
export class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  readonly targets = new Set<Element>();

  constructor(
    private readonly callback: IntersectionObserverCallback,
    readonly init?: IntersectionObserverInit,
  ) {
    MockIntersectionObserver.instances.push(this);
  }

  observe(el: Element): void {
    this.targets.add(el);
  }
  unobserve(el: Element): void {
    this.targets.delete(el);
  }
  disconnect(): void {
    this.targets.clear();
  }

  fire(el: Element, isIntersecting: boolean, intersectionRatio = isIntersecting ? 1 : 0): void {
    this.callback([{ target: el, isIntersecting, intersectionRatio } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }

  static get last(): MockIntersectionObserver {
    const io = MockIntersectionObserver.instances.at(-1);
    if (!io) throw new Error("no IntersectionObserver created");
    return io;
  }
}

export const mockIO = MockIntersectionObserver as unknown as typeof IntersectionObserver;

export function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}
