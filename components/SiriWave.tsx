import React, { useRef, useEffect } from 'react';

interface SiriWaveProps {
  isSpeaking: boolean;
  analyserNode: AnalyserNode | null;
}

const PALETTE = [
  'rgba(255, 120, 120, 0.7)', // Warm Coral
  'rgba(255, 180, 100, 0.6)', // Warm Gold/Orange
  'rgba(255, 140, 90, 0.7)',  // Warm Orange
  'rgba(255, 210, 120, 0.6)', // Light Gold
  'rgba(255, 130, 180, 0.6)', // Warm Pink
];

const toTransparent = (color: string) => {
    const match = color.match(/rgba?\((\d+,\s*\d+,\s*\d+),/);
    if (!match) return 'rgba(0,0,0,0)';
    return `rgba(${match[1]}, 0)`;
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

class WaveBlob {
  baseRadius: number;
  color: string;
  angle: number;
  rotationSpeed: number;
  offsetMagnitude: number;
  
  // Smoothed properties for fluid animation
  smoothedRotationSpeed: number;
  smoothedOffset: number;
  smoothedRadius: number;
  
  // Current position
  currentX: number;
  currentY: number;

  constructor(baseRadius: number, color: string, canvasCenter: number) {
    this.baseRadius = baseRadius;
    this.color = color;
    this.angle = Math.random() * Math.PI * 2;
    this.rotationSpeed = (Math.random() - 0.5) * 0.0008; 
    this.offsetMagnitude = Math.random() * 30 + 20;
    
    // Initialize smoothed values
    this.smoothedRotationSpeed = this.rotationSpeed;
    this.smoothedOffset = this.offsetMagnitude;
    this.smoothedRadius = this.baseRadius;

    this.currentX = canvasCenter + Math.cos(this.angle) * this.offsetMagnitude;
    this.currentY = canvasCenter + Math.sin(this.angle) * this.offsetMagnitude;
  }

  update(audioLevel: number, speakMix: number, canvasCenter: number) {
    const BLOB_DAMPING = 0.02;

    // --- Define targets for both states ---

    // LISTENING (calm) STATE TARGETS
    this.angle += this.rotationSpeed * 100;
    const calmTargetX = canvasCenter + Math.cos(this.angle) * this.offsetMagnitude;
    const calmTargetY = canvasCenter + Math.sin(this.angle) * this.offsetMagnitude;
    const calmPulse = Math.sin(this.angle * 0.5 + performance.now() / 1000) * 5;
    const calmTargetRadius = this.baseRadius + calmPulse;

    // SPEAKING (energetic) STATE TARGETS
    const energeticTargetX = canvasCenter;
    const energeticTargetY = canvasCenter;
    const energeticPulse = this.baseRadius * 0.8 * audioLevel;
    const energeticTargetRadius = this.baseRadius + energeticPulse;

    // --- Interpolate between states based on the smoothed speakMix ---
    const targetX = lerp(calmTargetX, energeticTargetX, speakMix);
    const targetY = lerp(calmTargetY, energeticTargetY, speakMix);
    const targetRadius = lerp(calmTargetRadius, energeticTargetRadius, speakMix);
    
    // Smoothly update the current properties towards their targets
    this.currentX = lerp(this.currentX, targetX, BLOB_DAMPING);
    this.currentY = lerp(this.currentY, targetY, BLOB_DAMPING);
    this.smoothedRadius = lerp(this.smoothedRadius, targetRadius, BLOB_DAMPING);
  }

  draw(ctx: CanvasRenderingContext2D) {
    const gradient = ctx.createRadialGradient(this.currentX, this.currentY, 0, this.currentX, this.currentY, this.smoothedRadius);
    gradient.addColorStop(0.2, this.color);
    gradient.addColorStop(1, toTransparent(this.color));
    
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(this.currentX, this.currentY, this.smoothedRadius, 0, Math.PI * 2);
    ctx.fill();
  }
}


const SiriWave: React.FC<SiriWaveProps> = ({ isSpeaking, analyserNode }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // FIX: Explicitly initialize useRef with `undefined` to satisfy the linter rule.
  const animationFrameId = useRef<number | undefined>(undefined);
  const blobs = useRef<WaveBlob[]>([]);
  const state = useRef({
    audioLevel: 0,
    targetAudioLevel: 0,
    speakMix: 0, // A smoothed value between 0 (listening) and 1 (speaking)
  });

  const BLOB_COUNT = 5;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let dpr: number, rect: DOMRect;

    const resize = () => {
      dpr = window.devicePixelRatio || 1;
      rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);

      const centerX = rect.width / 2;

      blobs.current = [];
      const baseSize = Math.min(rect.width, rect.height) * 0.3; // Base size of blobs
      for (let i = 0; i < BLOB_COUNT; i++) {
        blobs.current.push(new WaveBlob(baseSize * (Math.random() * 0.4 + 0.7), PALETTE[i % PALETTE.length], centerX));
      }
    };

    resize();
    window.addEventListener('resize', resize);

    const audioData = analyserNode ? new Uint8Array(analyserNode.frequencyBinCount) : null;

    const animate = () => {
      animationFrameId.current = requestAnimationFrame(animate);

      // --- Define smoothing constants ---
      const DAMPING_SPEAK_MIX = 0.04;
      const DAMPING_ATTACK = 0.1; // Faster response to sound
      const DAMPING_RELEASE = 0.05; // Slower decay

      // --- Update smoothed state variables ---

      // 1. Smoothly interpolate the speakMix value towards its target (0 or 1)
      const targetSpeakMix = isSpeaking ? 1 : 0;
      state.current.speakMix = lerp(state.current.speakMix, targetSpeakMix, DAMPING_SPEAK_MIX);

      // 2. Determine the target audio level based on input or a fallback pulse
      if (analyserNode && audioData && isSpeaking) {
        analyserNode.getByteFrequencyData(audioData);
        const sum = audioData.reduce((a, b) => a + b, 0);
        const avg = sum / audioData.length;
        // Normalize and square to make pulses more pronounced
        state.current.targetAudioLevel = Math.pow(Math.min(1, avg / 128), 2);
      } else {
        // If no analyser, create a gentle "breathing" pulse when speaking is intended
        state.current.targetAudioLevel = isSpeaking ? (0.6 + Math.sin(performance.now() / 200) * 0.4) : 0;
      }
      
      // 3. Smoothly interpolate the audioLevel with different attack/release rates
      const damping = state.current.audioLevel < state.current.targetAudioLevel ? DAMPING_ATTACK : DAMPING_RELEASE;
      state.current.audioLevel = lerp(state.current.audioLevel, state.current.targetAudioLevel, damping);

      const { width, height } = rect;
      const centerX = width / 2;
      
      ctx.clearRect(0, 0, width, height);
      
      const masterRadius = Math.min(width, height) / 2 * 0.95;
      
      ctx.save();
      
      // Create a soft-edged circular mask
      const maskGradient = ctx.createRadialGradient(centerX, centerX, masterRadius * 0.9, centerX, centerX, masterRadius);
      maskGradient.addColorStop(0, 'white');
      maskGradient.addColorStop(1, 'rgba(255,255,255,0)');
      
      ctx.beginPath();
      ctx.arc(centerX, centerX, masterRadius, 0, Math.PI * 2);
      ctx.clip();
      
      blobs.current.forEach(blob => {
        // Pass both audioLevel and the new speakMix to the update function
        blob.update(state.current.audioLevel, state.current.speakMix, centerX);
        blob.draw(ctx);
      });
      
      ctx.restore();
    };

    animate();

    return () => {
      window.removeEventListener('resize', resize);
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, [isSpeaking, analyserNode]);

  return <canvas ref={canvasRef} className="w-full h-full" style={{ background: 'transparent' }} />;
};

export default SiriWave;
