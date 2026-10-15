import { useCallback, useEffect, useRef, useState } from 'react';

export const MAX_IMAGES = 10;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export default function useChatAttachments({ setError }) {
  const [images, setImages] = useState([]);
  const [pendingImageReads, setPendingImageReads] = useState(0);
  const [isAttachMenuOpen, setIsAttachMenuOpen] = useState(false);
  const imagesRef = useRef([]);
  const imageReadQueueRef = useRef(Promise.resolve());
  const imagePreviewsRef = useRef([]);
  const imageFileInputRef = useRef(null);
  const attachmentMenuRef = useRef(null);

  useEffect(() => {
    if (!isAttachMenuOpen) return undefined;

    function handlePointerDown(event) {
      if (!attachmentMenuRef.current?.contains(event.target)) {
        setIsAttachMenuOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') setIsAttachMenuOpen(false);
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isAttachMenuOpen]);

  const replaceImages = useCallback((nextImages) => {
    const next = typeof nextImages === 'function' ? nextImages(imagesRef.current) : nextImages;
    imagesRef.current = next;
    setImages(next);
  }, []);

  const handleImageFiles = useCallback((files) => {
    if (!files?.length) return;
    setError(null);
    const accepted = [];
    for (const file of files) {
      if (!SUPPORTED_IMAGE_TYPES.includes(file.type)) {
        setError('Formato no compatible. Adjuntá imágenes JPEG, PNG, WebP o GIF.');
        continue;
      }
      if (file.size > MAX_IMAGE_SIZE) {
        setError(`La imagen ${file.name || ''} supera el límite de 5 MB.`.trim());
        continue;
      }
      accepted.push(file);
    }
    if (!accepted.length) return;

    setPendingImageReads(count => count + 1);
    const task = imageReadQueueRef.current.then(async () => {
      const remaining = Math.max(0, MAX_IMAGES - imagesRef.current.length);
      if (remaining === 0) {
        setError(`Podés adjuntar hasta ${MAX_IMAGES} imágenes por mensaje.`);
        return;
      }
      if (accepted.length > remaining) {
        setError(`Podés adjuntar hasta ${MAX_IMAGES} imágenes por mensaje; se agregaron las primeras ${remaining}.`);
      }
      const selected = accepted.slice(0, remaining);
      const loaded = await Promise.all(selected.map(async file => ({
        dataUrl: await fileAsDataUrl(file),
        name: file.name || 'Imagen pegada',
      })));
      replaceImages(current => [...current, ...loaded]);
    }).catch(() => {
      setError('No se pudo leer una imagen. Probá con otro archivo.');
    });
    imageReadQueueRef.current = task;
    void task.finally(() => setPendingImageReads(count => Math.max(0, count - 1)));
  }, [replaceImages, setError]);

  const handlePaste = useCallback((event, disabled = false) => {
    if (disabled) return;
    const files = [...(event.clipboardData?.items ?? [])]
      .filter(item => item.type.startsWith('image/'))
      .map(item => item.getAsFile())
      .filter(Boolean);
    if (!files.length) return;
    event.preventDefault();
    handleImageFiles(files);
  }, [handleImageFiles]);

  const handleFileSelection = useCallback((event) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    setIsAttachMenuOpen(false);
    if (files.length) handleImageFiles(files);
  }, [handleImageFiles]);

  const addLocalImagePreviews = useCallback((items) => {
    const previews = [...imagePreviewsRef.current];
    return items.map(message => {
      if (message.role !== 'user') return message;
      const previewIndex = previews.findIndex(preview => preview.content === message.content);
      if (previewIndex < 0) return message;
      const [preview] = previews.splice(previewIndex, 1);
      return { ...message, imageDataUrls: preview.dataUrls };
    });
  }, []);

  const rememberLocalImagePreview = useCallback((content, selectedImages) => {
    if (!selectedImages.length) return;
    imagePreviewsRef.current.push({ content, dataUrls: selectedImages.map(image => image.dataUrl) });
  }, []);
  const clearImages = useCallback(() => replaceImages([]), [replaceImages]);
  const removeImage = useCallback(index => replaceImages(current => current.filter((_, imageIndex) => imageIndex !== index)), [replaceImages]);

  return {
    images,
    pendingImageReads,
    isAttachMenuOpen,
    setIsAttachMenuOpen,
    clearImages,
    removeImage,
    handlePaste,
    handleFileSelection,
    addLocalImagePreviews,
    rememberLocalImagePreview,
    imageFileInputRef,
    attachmentMenuRef,
  };
}

function fileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Invalid image'));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read image'));
    reader.readAsDataURL(file);
  });
}
