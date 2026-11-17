import { describe, expect, it, vi } from "vitest";
import { EventQueue } from "../tracker/src/core";

describe("EventQueue", () => {
  it("flushes in chunks of maxBatch, each wrapped with context", () => {
    const sent: string[] = [];
    const q = new EventQueue<number>((ev) => ({ ctx: "s1", ev }), (b) => sent.push(b), 3, 100);
    for (let i = 0; i < 7; i++) q.push(i);
    expect(q.flush()).toBe(3);
    expect(sent.map((s) => JSON.parse(s).ev)).toEqual([[0, 1, 2], [3, 4, 5], [6]]);
    expect(JSON.parse(sent[0]!).ctx).toBe("s1");
    expect(q.size).toBe(0);
    expect(q.flush()).toBe(0);
  });

  it("drops the oldest events when the endpoint is unreachable for a long time", () => {
    const q = new EventQueue<number>((ev) => ev, () => {}, 10, 5);
    for (let i = 0; i < 9; i++) q.push(i);
    expect(q.size).toBe(5);
    const send = vi.fn();
    const q2 = new EventQueue<number>((ev) => ev, send, 10, 5);
    for (let i = 0; i < 9; i++) q2.push(i);
    q2.flush();
    expect(JSON.parse(send.mock.calls[0]![0])).toEqual([4, 5, 6, 7, 8]);
  });

  it("never throws when the transport throws", () => {
    const q = new EventQueue<number>((ev) => ev, () => {
      throw new Error("network down");
    });
    q.push(1);
    expect(() => q.flush()).not.toThrow();
  });

  it("works with a timer-driven flush (every 3 s)", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const q = new EventQueue<number>((ev) => ev, send);
    const t = setInterval(() => q.flush(), 3000);
    q.push(1);
    vi.advanceTimersByTime(2999);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledTimes(1);
    clearInterval(t);
    vi.useRealTimers();
  });
});
