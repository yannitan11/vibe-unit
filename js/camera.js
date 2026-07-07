// Webcam capture. Returns a ready <video> element or throws a typed error.

import { CAMERA } from './config.js';

export class CameraError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind; // 'denied' | 'notfound' | 'insecure' | 'unknown'
  }
}

export async function startCamera(video) {
  if (!window.isSecureContext && location.hostname !== 'localhost') {
    throw new CameraError(
      'insecure',
      'Camera needs HTTPS (or localhost). Open the secure link.'
    );
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraError('unknown', 'This browser can’t access the camera.');
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { ...CAMERA, facingMode: 'user' },
      audio: false,
    });
  } catch (err) {
    if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') {
      throw new CameraError('denied', 'Camera permission was blocked.');
    }
    if (err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError') {
      throw new CameraError('notfound', 'No camera was found on this device.');
    }
    throw new CameraError('unknown', err?.message || 'Camera failed to start.');
  }

  video.srcObject = stream;
  video.playsInline = true;
  video.muted = true;
  await video.play();

  // wait for real dimensions
  if (!video.videoWidth) {
    await new Promise((res) => {
      video.onloadedmetadata = () => res();
    });
  }
  return stream;
}
