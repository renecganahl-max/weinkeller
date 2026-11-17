// Photo helpers: read a picked file and shrink it to a JPEG data URL.

export function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve(img); setTimeout(() => URL.revokeObjectURL(url), 2000); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Das Foto konnte nicht geöffnet werden.')); };
    img.src = url;
  });
}

// Browsers apply the photo's EXIF rotation when drawing, so portrait shots stay upright.
export function imageToDataUrl(img, maxSide = 1280, quality = 0.85) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}
