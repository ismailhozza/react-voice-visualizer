import { useEffect, useRef, useState } from "react";

import {
  formatDurationTime,
  formatRecordedAudioTime,
  formatRecordingTime,
  getFileExtensionFromMimeType,
} from "../helpers";
import { Controls, useVoiceVisualizerParams } from "../types/types.ts";

function useVoiceVisualizer({
  onStartRecording,
  onStopRecording,
  onPausedRecording,
  onResumedRecording,
  onClearCanvas,
  onEndAudioPlayback,
  onStartAudioPlayback,
  onPausedAudioPlayback,
  onResumedAudioPlayback,
  onErrorPlayingAudio,
}: useVoiceVisualizerParams = {}): Controls {
  const [isRecordingInProgress, setIsRecordingInProgress] = useState(false);
  const [isPausedRecording, setIsPausedRecording] = useState(false);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [audioData, setAudioData] = useState<Uint8Array>(new Uint8Array(0));
  const [isProcessingAudioOnComplete, _setIsProcessingAudioOnComplete] =
    useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [bufferFromRecordedBlob, setBufferFromRecordedBlob] =
    useState<AudioBuffer | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [prevTime, setPrevTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [audioSrc, setAudioSrc] = useState("");
  const [isPausedRecordedAudio, setIsPausedRecordedAudio] = useState(true);
  const [currentAudioTime, setCurrentAudioTime] = useState(0);
  const [isCleared, setIsCleared] = useState(true);
  const [isProcessingOnResize, _setIsProcessingOnResize] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const rafRecordingRef = useRef<number | null>(null);
  const rafCurrentTimeUpdateRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const isAvailableRecordedAudio = Boolean(
    bufferFromRecordedBlob && !isProcessingAudioOnComplete,
  );
  const formattedDuration = formatDurationTime(duration);
  const formattedRecordingTime = formatRecordingTime(recordingTime);
  const formattedRecordedAudioCurrentTime =
    formatRecordedAudioTime(currentAudioTime);
  const isProcessingRecordedAudio =
    isProcessingOnResize || isProcessingAudioOnComplete;

  useEffect(() => {
    if (!isRecordingInProgress || isPausedRecording) return;

    const updateTimer = () => {
      const timeNow = performance.now();
      setRecordingTime((prev) => prev + (timeNow - prevTime));
      setPrevTime(timeNow);
    };

    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [prevTime, isPausedRecording, isRecordingInProgress]);

  useEffect(() => {
    if (error) {
      clearCanvas();
      return;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  useEffect(() => {
    return () => {
      clearCanvas();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isCleared) {
      window.addEventListener("beforeunload", handleBeforeUnload);
    }

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [isCleared]);

  const handleBeforeUnload = (e: BeforeUnloadEvent) => {
    e.preventDefault();
    e.returnValue = "";
  };

  const processBlob = async (blob: Blob) => {
    if (!blob) return;

    try {
      if (blob.size === 0) {
        throw new Error("Error: The audio blob is empty");
      }

      const audioSrcFromBlob = URL.createObjectURL(blob);
      setAudioSrc(audioSrcFromBlob);

      const audioBuffer = await blob.arrayBuffer();
      const audioContext = new AudioContext();
      const buffer = await audioContext.decodeAudioData(audioBuffer);
      setBufferFromRecordedBlob(buffer);
      setDuration(buffer.duration - 0.06);

      setError(null);
    } catch (error) {
      console.error("Error processing the audio blob:", error);
      setError(
        error instanceof Error
          ? error
          : new Error("Error processing the audio blob"),
      );
    }
  };

  const getUserMedia = () => {
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        setPrevTime(performance.now());
        setIsRecordingInProgress(true);
        setAudioStream(stream);
        audioContextRef.current = new window.AudioContext();
        analyserRef.current = audioContextRef.current.createAnalyser();
        dataArrayRef.current = new Uint8Array(
          analyserRef.current.frequencyBinCount,
        );
        sourceRef.current =
          audioContextRef.current.createMediaStreamSource(stream);
        sourceRef.current.connect(analyserRef.current);
        mediaRecorderRef.current = new MediaRecorder(stream);
        mediaRecorderRef.current.addEventListener(
          "dataavailable",
          handleDataAvailable,
        );
        mediaRecorderRef.current.start();

        recordingFrame();
      })
      .catch((error) => {
        console.error("Error starting audio recording:", error);
        if (error instanceof Error) {
          setError(error);
          return;
        }
        setError(new Error("Error starting audio recording"));
      });
  };

  const recordingFrame = () => {
    analyserRef.current!.getByteTimeDomainData(dataArrayRef.current!);
    setAudioData(new Uint8Array(dataArrayRef.current!));
    rafRecordingRef.current = requestAnimationFrame(recordingFrame);
  };

  const handleDataAvailable = (event: BlobEvent) => {
    audioRef.current = new Audio();
    setRecordedBlob(event.data);
    void processBlob(event.data);
  };

  const handleTimeUpdate = () => {
    if (!audioRef.current) return;
    setCurrentAudioTime(audioRef.current.currentTime);

    rafCurrentTimeUpdateRef.current = requestAnimationFrame(handleTimeUpdate);
  };

  const startRecording = () => {
    clearCanvas();
    setIsCleared(false);
    if (isRecordingInProgress) return;
    if (onStartRecording) onStartRecording();
    getUserMedia();
  };

  const stopRecording = () => {
    if (!isRecordingInProgress) return;

    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.removeEventListener(
        "dataavailable",
        handleDataAvailable,
      );
      mediaRecorderRef.current = null;
    }
    audioStream?.getTracks().forEach((track) => track.stop());
    if (onStopRecording) onStopRecording();
    if (rafRecordingRef.current) cancelAnimationFrame(rafRecordingRef.current);
    if (sourceRef.current) sourceRef.current.disconnect();
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      void audioContextRef.current.close();
    }
    _setIsProcessingAudioOnComplete(true);
    setIsRecordingInProgress(false);
    setRecordingTime(0);
    setIsPausedRecording(false);
  };

  const clearCanvas = () => {
    if (rafRecordingRef.current) {
      cancelAnimationFrame(rafRecordingRef.current);
    }
    if (rafCurrentTimeUpdateRef.current) {
      cancelAnimationFrame(rafCurrentTimeUpdateRef.current);
    }
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.removeEventListener(
        "dataavailable",
        handleDataAvailable,
      );
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }

    audioStream?.getTracks().forEach((track) => track.stop());
    if (audioRef?.current) {
      audioRef.current.removeEventListener("ended", onEndedRecordedAudio);
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    mediaRecorderRef.current = null;
    audioContextRef.current = null;
    analyserRef.current = null;
    dataArrayRef.current = null;
    sourceRef.current = null;
    rafRecordingRef.current = null;
    rafCurrentTimeUpdateRef.current = null;

    if (onClearCanvas) onClearCanvas();
    setAudioStream(null);
    setIsRecordingInProgress(false);
    _setIsProcessingAudioOnComplete(false);
    setRecordedBlob(null);
    setBufferFromRecordedBlob(null);
    setRecordingTime(0);
    setPrevTime(0);
    setDuration(0);
    setAudioSrc("");
    setCurrentAudioTime(0);
    setIsPausedRecordedAudio(true);
    setIsPausedRecording(false);
    setAudioData(new Uint8Array(0));
    setError(null);
    setIsCleared(true);
  };

  const startPlayingAudio = () => {
    if (audioRef.current && audioRef.current.paused) {
      const audioPromise = audioRef.current.play();
      if (audioPromise !== undefined) {
        audioPromise.catch((error) => {
          console.error(error);
          if (onErrorPlayingAudio) {
            onErrorPlayingAudio(
              error instanceof Error ? error : new Error("Error playing audio"),
            );
          }
        });
      }
    }
  };

  const togglePauseResume = () => {
    if (isRecordingInProgress) {
      setIsPausedRecording((prevPaused) => !prevPaused);
      if (mediaRecorderRef.current?.state === "recording") {
        if (onPausedRecording) onPausedRecording();
        mediaRecorderRef.current?.pause();
        setRecordingTime((prev) => prev + (performance.now() - prevTime));
        if (rafRecordingRef.current) {
          cancelAnimationFrame(rafRecordingRef.current);
        }
      } else {
        if (onResumedRecording) onResumedRecording();
        mediaRecorderRef.current?.resume();
        setPrevTime(performance.now());
        rafRecordingRef.current = requestAnimationFrame(recordingFrame);
      }
      return;
    }

    if (audioRef.current && isAvailableRecordedAudio) {
      if (audioRef.current.paused) {
        if (onStartAudioPlayback && currentAudioTime === 0) {
          onStartAudioPlayback();
        }
        if (onResumedAudioPlayback && currentAudioTime !== 0) {
          onResumedAudioPlayback();
        }
        requestAnimationFrame(handleTimeUpdate);
        audioRef.current.addEventListener("ended", onEndedRecordedAudio);
        startPlayingAudio();
        setIsPausedRecordedAudio(false);
      } else {
        if (rafCurrentTimeUpdateRef.current) {
          cancelAnimationFrame(rafCurrentTimeUpdateRef.current);
        }
        if (onPausedAudioPlayback) onPausedAudioPlayback();
        audioRef.current.removeEventListener("ended", onEndedRecordedAudio);
        audioRef.current.pause();
        setIsPausedRecordedAudio(true);
        const newCurrentTime = audioRef.current.currentTime;
        setCurrentAudioTime(newCurrentTime);
        audioRef.current.currentTime = newCurrentTime;
      }
    }
  };

  const onEndedRecordedAudio = () => {
    if (rafCurrentTimeUpdateRef.current) {
      cancelAnimationFrame(rafCurrentTimeUpdateRef.current);
    }
    setIsPausedRecordedAudio(true);
    if (onEndAudioPlayback) onEndAudioPlayback();
    if (!audioRef?.current) return;
    audioRef.current.currentTime = 0;
    setCurrentAudioTime(0);
  };

  const saveAudioFile = () => {
    if (!audioSrc) return;

    const downloadAnchor = document.createElement("a");
    downloadAnchor.href = audioSrc;
    downloadAnchor.download = `recorded_audio${getFileExtensionFromMimeType(
      mediaRecorderRef.current?.mimeType,
    )}`;
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    document.body.removeChild(downloadAnchor);
    URL.revokeObjectURL(audioSrc);
  };

  return {
    audioRef,
    isRecordingInProgress,
    isPausedRecording,
    audioData,
    recordingTime,
    isProcessingRecordedAudio,
    recordedBlob,
    mediaRecorder: mediaRecorderRef.current,
    duration,
    currentAudioTime,
    audioSrc,
    isPausedRecordedAudio,
    bufferFromRecordedBlob,
    isCleared,
    isAvailableRecordedAudio,
    formattedDuration,
    formattedRecordingTime,
    formattedRecordedAudioCurrentTime,
    startRecording,
    togglePauseResume,
    stopRecording,
    saveAudioFile,
    clearCanvas,
    setCurrentAudioTime,
    error,
    _setIsProcessingAudioOnComplete,
    _setIsProcessingOnResize,
  };
}

export default useVoiceVisualizer;
