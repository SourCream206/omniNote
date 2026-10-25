// Runs in a browser Worker, without Node or direct filesystem access.
self.onmessage = (event) => {
  if (event.data?.type !== 'invoke' || event.data.command !== 'whiteboard.date-insert.insertDate') return;
  const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(new Date());
  self.postMessage({ type: 'canvas.insertText', requestId: event.data.requestId, text: date });
};
