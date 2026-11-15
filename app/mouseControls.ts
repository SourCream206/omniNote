export type MousePanButton = 'middle' | 'right' | 'none';

export function readMousePanButton(storage: Pick<Storage, 'getItem'> = localStorage): MousePanButton {
  const saved = storage.getItem('omninote.mousePanButton');
  return saved === 'right' || saved === 'none' ? saved : 'middle';
}

export function isMousePanPress(event: Pick<PointerEvent, 'pointerType' | 'button'>, button: MousePanButton): boolean {
  return event.pointerType === 'mouse' && (button === 'middle' && event.button === 1 || button === 'right' && event.button === 2);
}
