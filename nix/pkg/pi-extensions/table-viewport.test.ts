import assert from "node:assert/strict";
import test from "node:test";
import type { TuiMouseEvent } from "@earendil-works/pi-tui";
import { TableViewport } from "./table-viewport.ts";

function fixture(rows: number, lineCount: number) {
	let renders = 0;
	const view = new TableViewport(() => rows, () => { renders++; });
	view.reconcile({ lineCount, scrollTop: 0 });
	return { view, renders: () => renders, resize: (n: number) => { rows = n; } };
}

test("table arrows and j/k move one line; pages move by the full current budget", () => {
	const { view, resize, renders } = fixture(26, 58);
	for (const [key, top] of [["\x1b[B", 1], ["\x1b[106u", 2], ["k", 1], ["\x1b[A", 0], ["\x1b[6~", 10]] as const) {
		view.handleInput(key);
		assert.equal(view.scrollTop, top, key);
	}
	resize(35);
	view.handleInput("\x1b[6~");
	assert.equal(view.scrollTop, 24);
	view.handleInput("\x1b[5~");
	assert.equal(view.scrollTop, 10);
	view.handleInput("\x1b[F");
	assert.equal(view.scrollTop, 44);
	view.handleInput("j");
	assert.equal(view.scrollTop, 44);
	view.handleInput("\x1b[H");
	view.handleInput("\x1b[5~");
	view.handleInput("s");
	assert.equal(view.scrollTop, 0);
	assert.equal(renders(), 9);
});

test("only an effective manual resize pins the budget and clamps the offset", () => {
	const { view, resize, renders } = fixture(200, 100);
	view.handleInput("+");
	assert.equal(view.budget, 60);
	resize(8);
	view.handleInput("-");
	assert.equal(view.budget, 5);
	resize(27);
	assert.equal(view.budget, 10);
	assert.equal(renders(), 0);
	view.handleInput("\x1b[F");
	assert.equal(view.scrollTop, 90);
	view.handleInput("=");
	assert.equal(view.scrollTop, 85);
	resize(100);
	assert.equal(view.budget, 15);
	for (const [key, budget] of [["+", 20], ["_", 15], ["-", 10]] as const) {
		view.handleInput(key);
		assert.equal(view.budget, budget);
	}
	assert.equal(renders(), 5);
});

test("navigation resumes at the rendered offset using the new content length", () => {
	const { view, renders } = fixture(26, 90);
	view.handleInput("\x1b[F");
	view.reconcile({ lineCount: 23, scrollTop: 13 });
	view.handleInput("\x1b[5~");
	assert.equal(view.scrollTop, 3);
	view.handleInput("\x1b[F");
	assert.equal(view.scrollTop, 13);
	view.reset();
	assert.equal(view.scrollTop, 0);
	assert.equal(renders(), 3);
});

test("wheel uses sign, consumes the boundary without repainting, and leaves other events alone", () => {
	const { view, renders } = fixture(26, 14);
	const event: TuiMouseEvent = { type: "wheel", button: "none", x: 0, y: 0, screenX: 0, screenY: 0, width: 80, height: 26, shift: false, alt: false, ctrl: false };
	for (const [wheelDelta, top, redraws] of [[-8, 0, 0], [8, 3, 1], [1, 4, 2], [10, 4, 2], [-1, 1, 3]] as const) {
		assert.deepEqual(view.handleMouse({ ...event, wheelDelta }), { handled: true, render: false });
		assert.equal(view.scrollTop, top);
		assert.equal(renders(), redraws);
	}
	assert.equal(view.handleMouse({ ...event, wheelDelta: 0 }), undefined);
	assert.equal(view.handleMouse({ ...event, type: "click", button: "left" }), undefined);
	assert.equal(renders(), 3);
});
