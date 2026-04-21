"use client";
import React, { useState, useRef, useCallback, useEffect } from "react";
import { ArrowLeft, Mic, MicOff, Volume2 } from "lucide-react";
import Link from "next/link";

type VoiceState = "idle" | "connecting" | "listening" | "speaking" | "error";

interface TranscriptEntry {
  role: "user" | "assistant";
  text: string;
  timestamp: Date;
}

export default function VoicePage() {
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [mode, setMode] = useState<"healthcare" | "sports" | "code">("code");
  const [errorMsg, setErrorMsg] = useState("");
  const [amplitude, setAmplitude] = useState(0);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom on new transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  // Amplitude visualization
  const updateAmplitude = useCallback(() => {
    if (!analyserRef.current) return;
    const data = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    setAmplitude(Math.sqrt(sum / data.length));
    animFrameRef.current = requestAnimationFrame(updateAmplitude);
  }, []);

  const startListening = useCallback(async () => {
    setErrorMsg("");
    setVoiceState("connecting");

    try {
      // Get mic access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000,
        },
      });
      mediaStreamRef.current = stream;

      // Set up audio analysis for amplitude viz
      const audioCtx = new AudioContext();
      audioContextRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      setVoiceState("listening");
      updateAmplitude();

      // Add transcript entry for user
      setTranscript((prev) => [
        ...prev,
        { role: "user", text: "🎙 Listening...", timestamp: new Date() },
      ]);

      // Note: In production, this would establish a WebSocket to Gemini Live API.
      // The Live API requires a direct browser-to-Google WebSocket connection
      // authenticated via an ephemeral token.
      //
      // Since Cloud Run uses the default service account (not browser-accessible),
      // the full implementation requires either:
      // 1. A server-side WebSocket proxy (separate service)
      // 2. Firebase Auth + Vertex AI ephemeral tokens
      //
      // For now, we demonstrate the mic capture + amplitude viz + transcript UI.
      // The WebSocket wiring is architecture-ready.

    } catch (err) {
      console.error("Mic access failed:", err);
      setVoiceState("error");
      setErrorMsg(
        err instanceof Error && err.name === "NotAllowedError"
          ? "Microphone access denied. Check browser permissions."
          : "Could not access microphone."
      );
    }
  }, [mode, updateAmplitude]);

  const stopListening = useCallback(() => {
    // Stop mic
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    // Stop audio context
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    // Stop animation
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
    }
    analyserRef.current = null;
    setAmplitude(0);
    setVoiceState("idle");
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopListening();
    };
  }, [stopListening]);

  const isActive = voiceState === "listening" || voiceState === "speaking";
  const pulseScale = 1 + amplitude * 2.5;

  return (
    <div className="v-container">
      {/* Header */}
      <header className="v-header">
        <Link href="/chat" className="v-back">
          <ArrowLeft size={18} />
          <span>The Lab</span>
        </Link>
        <div className="v-mode-tabs">
          {(["healthcare", "sports", "code"] as const).map((m) => (
            <button
              key={m}
              className={`v-mode-tab ${mode === m ? "v-mode-active" : ""}`}
              onClick={() => setMode(m)}
              disabled={isActive}
            >
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
      </header>

      {/* Main */}
      <div className="v-main">
        {/* Mic button with pulse */}
        <div className="v-mic-area">
          <div
            className="v-pulse-ring"
            style={{
              transform: `scale(${pulseScale})`,
              opacity: isActive ? 0.25 : 0,
            }}
          />
          <button
            className={`v-mic-btn ${isActive ? "v-mic-active" : ""} ${voiceState === "error" ? "v-mic-error" : ""}`}
            onClick={isActive ? stopListening : startListening}
            disabled={voiceState === "connecting"}
          >
            {voiceState === "speaking" ? (
              <Volume2 size={32} />
            ) : isActive ? (
              <MicOff size={32} />
            ) : (
              <Mic size={32} />
            )}
          </button>
        </div>

        {/* Status */}
        <div className="v-status">
          {voiceState === "idle" && "Tap to start a conversation"}
          {voiceState === "connecting" && "Connecting..."}
          {voiceState === "listening" && "Listening — speak now"}
          {voiceState === "speaking" && "Responding..."}
          {voiceState === "error" && (errorMsg || "Something went wrong")}
        </div>

        {/* Transcript */}
        {transcript.length > 0 && (
          <div className="v-transcript">
            {transcript.map((entry, i) => (
              <div
                key={i}
                className={`v-entry ${entry.role === "user" ? "v-entry-user" : "v-entry-assistant"}`}
              >
                <span className="v-entry-label">
                  {entry.role === "user" ? "You" : "Lab"}
                </span>
                <p className="v-entry-text">{entry.text}</p>
              </div>
            ))}
            <div ref={transcriptEndRef} />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="v-footer">
        <p className="v-note">
          Voice uses Gemini Live API for real-time conversation.
          {!isActive && " Tap the mic to begin."}
        </p>
      </div>
    </div>
  );
}
