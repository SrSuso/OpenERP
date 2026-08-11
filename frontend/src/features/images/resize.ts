/** El lado más largo al que se recorta una foto antes de subirla. Da de
 * sobra para el botón del TPV y para la ficha, y deja el fichero en unas
 * decenas de kB. */
const MAX_SIDE = 512;

/** Calidad del JPEG resultante. Por debajo de 0,8 se empieza a notar en
 * fotos de producto con texto (etiquetas, envases). */
const QUALITY = 0.8;

/**
 * Deja la foto elegida en algo que se pueda guardar: la recorta a
 * `MAX_SIDE` por el lado más largo y la devuelve como data URL JPEG.
 *
 * Se hace aquí, y no en el servidor, porque una foto de móvil son varios
 * megas y esto la deja en decenas de kB *antes* de enviarla: no hay que
 * subirla entera para tirar el 99% al llegar, y el backend se libra de
 * cargar con una librería de imágenes. Lo que llega allí sólo se comprueba
 * (formato y tamaño), no se toca — ver `app/catalog/images.py`.
 *
 * La transparencia se pierde (un PNG con fondo transparente sale sobre
 * blanco): un JPEG no la tiene, y a cambio ocupa una fracción.
 */
export async function resizeToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('No se ha podido preparar la imagen.');

    // Fondo blanco antes de dibujar: sin esto, lo transparente sale negro
    // al pasar a JPEG.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);

    return canvas.toDataURL('image/jpeg', QUALITY);
  } finally {
    bitmap.close();
  }
}
