import test from "node:test";
import assert from "node:assert/strict";
import { WasiBridge } from "../dist/core/index.js";

const WASI_ESUCCESS = 0;
const WASI_EAGAIN = 6;

function createBridge() {
  const bridge = new WasiBridge({
    args: [],
    env: {},
    stdout: () => {},
    stderr: () => {},
    onExit: () => {},
  });
  const memory = new WebAssembly.Memory({ initial: 1 });
  bridge.attachMemory(memory);
  return { bridge, memory, view: new DataView(memory.buffer), u8: new Uint8Array(memory.buffer) };
}

test("fd_read preserves unread stdin bytes for subsequent reads", () => {
  const { bridge, view, u8 } = createBridge();
  const wasi = bridge.imports;

  bridge.pushInput("hello");

  const iovsPtr = 64;
  const bufPtr = 128;
  const nreadPtr = 48;

  view.setUint32(iovsPtr, bufPtr, true);
  view.setUint32(iovsPtr + 4, 2, true);

  const firstRc = wasi.fd_read(0, iovsPtr, 1, nreadPtr);
  assert.equal(firstRc, WASI_ESUCCESS);
  assert.equal(view.getUint32(nreadPtr, true), 2);
  assert.equal(new TextDecoder().decode(u8.slice(bufPtr, bufPtr + 2)), "he");

  view.setUint32(iovsPtr + 4, 3, true);
  const secondRc = wasi.fd_read(0, iovsPtr, 1, nreadPtr);
  assert.equal(secondRc, WASI_ESUCCESS);
  assert.equal(view.getUint32(nreadPtr, true), 3);
  assert.equal(new TextDecoder().decode(u8.slice(bufPtr, bufPtr + 3)), "llo");

  const emptyRc = wasi.fd_read(0, iovsPtr, 1, nreadPtr);
  assert.equal(emptyRc, WASI_EAGAIN);
});

test("poll_oneoff only signals fd_read subscriptions when input is queued", () => {
  const { bridge, view } = createBridge();
  const wasi = bridge.imports;

  const inPtr = 256;
  const outPtr = 512;
  const neventsPtr = 200;

  view.setBigUint64(inPtr, 0x0102030405060708n, true);
  view.setUint8(inPtr + 8, 1); // fd_read

  const noInputRc = wasi.poll_oneoff(inPtr, outPtr, 1, neventsPtr);
  assert.equal(noInputRc, WASI_ESUCCESS);
  assert.equal(view.getUint32(neventsPtr, true), 0);

  bridge.pushInput("x");
  const withInputRc = wasi.poll_oneoff(inPtr, outPtr, 1, neventsPtr);
  assert.equal(withInputRc, WASI_ESUCCESS);
  assert.equal(view.getUint32(neventsPtr, true), 1);
  assert.equal(view.getBigUint64(outPtr, true), 0x0102030405060708n);
  assert.equal(view.getUint8(outPtr + 10), 1);

  const clockSubPtr = inPtr + 48;
  view.setBigUint64(clockSubPtr, 0x1111222233334444n, true);
  view.setUint8(clockSubPtr + 8, 0); // clock
  const clockRc = wasi.poll_oneoff(clockSubPtr, outPtr, 1, neventsPtr);
  assert.equal(clockRc, WASI_ESUCCESS);
  assert.equal(view.getUint32(neventsPtr, true), 0);
});
