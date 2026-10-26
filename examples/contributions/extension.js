self.onmessage = (event) => {
  const { command, requestId, settings, context } = event.data ?? {};
  if (command === 'omninote.contributions.card') self.postMessage({ type: 'canvas.insertObject', requestId, objectType: 'demo.card', data: { label: settings.label } });
  if (command === 'omninote.contributions.import') self.postMessage({ type: 'canvas.insertText', requestId, text: `Imported ${context?.asset?.name}: ${context?.bytes?.length ?? 0} bytes` });
  if (command === 'omninote.contributions.export') self.postMessage({ type: 'export.writeFile', requestId, name: 'omninote-demo.txt', bytes: new TextEncoder().encode(String(settings.label)) });
};
