const MAX_DIM = 1600;
const QUALITY = 0.82;

// Draws any canvas-drawable source (an <img>, a live <video> frame, a
// rendered PDF page) into a size-capped canvas and returns a JPEG data URL —
// every scan entry point (live camera, gallery pick, PDF) ends up here so
// they all land well under Claude's recommended image size and the
// backend's request body limit, regardless of the source's native size.
function toDataUrl(source, sourceWidth, sourceHeight) {
  const scale = Math.min(1, MAX_DIM / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sourceWidth * scale);
  canvas.height = Math.round(sourceHeight * scale);
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", QUALITY);
}

// Phone camera photos / gallery picks can be several MB.
export function resizeImageFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const dataUrl = toDataUrl(img, img.width, img.height);
      URL.revokeObjectURL(url);
      resolve(dataUrl);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Не удалось прочитать фото"));
    };
    img.src = url;
  });
}

// A frame grabbed from the in-app live camera preview.
export function captureVideoFrame(video) {
  return toDataUrl(video, video.videoWidth, video.videoHeight);
}

// Renders a PDF's first page to the same shape of data URL as a photo —
// receipts saved/forwarded as PDF (bank exports, email receipts) are almost
// always single-page, and Claude Vision takes images, not PDF documents, in
// this flow. Rendered at a higher scale than the final upload size so small
// receipt text stays legible after toDataUrl's own downscale.
//
// pdfjs-dist (~1MB) is dynamically imported here rather than at module
// scope — it would otherwise ship in every visitor's initial bundle for a
// feature only the "Загрузить PDF" tap ever needs.
export async function renderPdfFirstPageToDataUrl(file) {
  const [pdfjsLib, { default: pdfjsWorker }] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  return toDataUrl(canvas, canvas.width, canvas.height);
}
