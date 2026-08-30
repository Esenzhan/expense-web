// Express 4 only catches errors thrown *synchronously* by a handler. Every
// route here is async, so a throw (or a rejected query) inside one becomes
// a rejected promise Express never sees: no response is ever sent, the
// request hangs until the browser times out, and Node's default
// unhandledRejection behaviour takes the whole process down with it —
// which on Render kills every other in-flight request too.
//
// wrapRouterAsync patches each of a router's handlers to route a rejection
// into next(err), so the error middleware below can turn it into a plain
// 500 JSON the frontend already knows how to display.
export function wrapRouterAsync(router) {
  for (const layer of router.stack) {
    if (!layer.route) continue;
    for (const handlerLayer of layer.route.stack) {
      const handler = handlerLayer.handle;
      // 4 args = an error handler, left alone.
      if (typeof handler !== "function" || handler.length >= 4) continue;
      handlerLayer.handle = function wrapped(req, res, next) {
        let result;
        try {
          result = handler.call(this, req, res, next);
        } catch (err) {
          return next(err);
        }
        if (result && typeof result.catch === "function") result.catch(next);
        return result;
      };
    }
  }
  return router;
}

// Last resort: a handler that failed without answering for itself. Anything
// deliberate (validation, 404, 409) has already sent its own response by
// the time it gets here, so this only ever fires on a genuine bug.
export function errorHandler(err, req, res, next) {
  console.error(`${req.method} ${req.originalUrl} failed:`, err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Что-то пошло не так на сервере" });
}
