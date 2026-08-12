import { afterEach, describe, expect, it, vi } from 'vitest';

import { broadcastChange, onChangeBroadcast } from './changeBroadcast';

/** Deja que el navegador reparta lo que se acaba de mandar. */
const delivered = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('changeBroadcast', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reaches another tab', async () => {
    // Otra pestaña = otro canal con el mismo nombre, que es exactamente lo
    // que hace el navegador.
    const otherTab = new BroadcastChannel('openerp-changes');
    const heard = vi.fn();
    otherTab.onmessage = heard;

    broadcastChange();
    await delivered();
    otherTab.close();

    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('does not come back to the tab that sent it', async () => {
    // Si volviera, el TPV se recargaría el catálogo entero cada vez que
    // toca un producto: cada línea del carrito es una escritura, y toda
    // escritura avisa.
    const heard = vi.fn();
    const stop = onChangeBroadcast(heard);

    broadcastChange();
    await delivered();
    stop();

    expect(heard).not.toHaveBeenCalled();
  });

  it('stops listening when asked', async () => {
    const heard = vi.fn();
    onChangeBroadcast(heard)();

    const otherTab = new BroadcastChannel('openerp-changes');
    otherTab.postMessage('changed');
    await delivered();
    otherTab.close();

    expect(heard).not.toHaveBeenCalled();
  });
});
