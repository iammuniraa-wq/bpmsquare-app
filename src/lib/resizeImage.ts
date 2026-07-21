"use client";

/**
 * Downscales an uploaded image to fit within maxWidth x maxHeight before it's
 * uploaded — logos come in wildly different native sizes (a phone photo of a
 * signboard vs. a 20px favicon export), and every place a logo prints (quote
 * letterhead, sidebar, settings preview) already constrains it visually via
 * CSS — this just keeps the stored file itself sane instead of uploading
 * whatever the source happened to be. SVGs pass through unchanged: they're
 * vector, so canvas-rasterizing one would only lose quality, not bind it to
 * anything. Images already smaller than the box also pass through unchanged
 * (never upscale). Output is always PNG, which preserves transparency.
 */
export function resizeImageFile(file: File, maxWidth: number, maxHeight: number): Promise<File> {
  if (file.type === "image/svg+xml") return Promise.resolve(file);

  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      if (img.width <= maxWidth && img.height <= maxHeight) {
        resolve(file);
        return;
      }

      const scale = Math.min(maxWidth / img.width, maxHeight / img.height);
      const width = Math.round(img.width * scale);
      const height = Math.round(img.height * scale);

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(file); return; }
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob((blob) => {
        if (!blob) { resolve(file); return; }
        const resized = new File(
          [blob],
          file.name.replace(/\.\w+$/, "") + ".png",
          { type: "image/png" }
        );
        resolve(resized);
      }, "image/png");
    };

    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}
