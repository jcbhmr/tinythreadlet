function URLCanParse(url) {
  try {
    new URL(url);
  } catch {
    return false;
  }
  return true;
}

function pEvent(eventTarget, type, filter) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const { signal } = controller;
    eventTarget.addEventListener(
      type,
      (e) => {
        if (filter && !filter(e)) {
          return;
        }
        resolve(e);
        controller.abort();
      },
      { signal },
    );
    eventTarget.addEventListener(
      "error",
      (e) => {
        reject(e.error ?? e);
        controller.abort();
      },
      { signal },
    );
  });
}

const controllerCode = `
globalThis.onmessage = async (e) => {
  const [channel, moduleURL, this_, arguments_] = e.data;
  /** @type {[string] | [void, any]} */
  let r;
  try {
    const module = await import(moduleURL);
    r = [await module.default.apply(this_, arguments_)];
  } catch (e) {
    r = [, e];
  }
  r.unshift(channel);
  postMessage(r);
};
`;

/** @type {{ worker: Worker } | null | undefined} */
let cache;

/** @returns {Worker} */
function getWorker() {
  if (!cache) {
    const u = URL.createObjectURL(
      new Blob([controllerCode], { type: "text/javascript" }),
    );
    const worker = new Worker(u, { type: "module", name: "greenlet" });
    cache = { worker };
  }
  return cache.worker;
}

/**
 * @template T
 * @template {any[]} A
 * @template R
 * @param {((this: T, ...args: A) => R) | string | URL} functionOrURL
 * @returns {(this: T, ...args: A) => Promise<R>}
 */
function greenlet(functionOrURL) {
  let executorURL;
  let maybeFunction;
  if (typeof functionOrURL === "function") {
    maybeFunction = functionOrURL;
    const code = `export default ${functionOrURL}`;
    executorURL = URL.createObjectURL(
      new Blob([code], { type: "text/javascript" }),
    );
  } else if (URLCanParse(functionOrURL)) {
    executorURL = functionOrURL;
  } else {
    const code = `export default ${functionOrURL}`;
    executorURL = URL.createObjectURL(
      new Blob([code], { type: "text/javascript" }),
    );
  }

  const { run } = {
    async run() {
      const channel = Math.random().toString();
      const worker = getWorker();
      const p = pEvent(worker, "message", (e) => e.data[0] === channel);
      worker.postMessage([channel, executorURL, this, [...arguments]]);
      const e = await p;
      if (e.data.length === 2) {
        return e.data[1];
      } else {
        throw e.data[2];
      }
    },
  };
  if (typeof maybeFunction === "function") {
    Object.defineProperties(
      run,
      Object.getOwnPropertyDescriptors(maybeFunction),
    );
  }

  return run;
}

export default greenlet;
