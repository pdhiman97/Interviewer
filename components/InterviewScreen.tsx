import { transcribeAudio } from "../utils/elevenStt";
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { TranscriptEntry } from '../types';
import Avatar from './Avatar';
import { toast } from './Toaster';
import { GeminiChatService } from '../services/geminiChatService';
import CodeEditor from './CodeEditor';
import { SupportedLanguage } from '../services/judge0Service';

interface InterviewScreenProps {
  jobRole: string;
  jobDescription?: string;
  onFinish: (transcript: TranscriptEntry[]) => void;
}

type SessionState = 'idle' | 'starting' | 'active' | 'error';

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
    reader.readAsDataURL(file);
  });
};

const InterviewScreen: React.FC<InterviewScreenProps> = ({ jobRole, jobDescription, onFinish }) => {
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [textInput, setTextInput] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("Something went wrong. Please check permissions and try again.");
  const [showCodeEditor, setShowCodeEditor] = useState(false);
  const [currentCode, setCurrentCode] = useState<string>('');
  const [currentLanguage, setCurrentLanguage] = useState<SupportedLanguage>('javascript');
  
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const chatServiceRef = useRef<GeminiChatService | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const stalemateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const greetingAudioBufferRef = useRef<ArrayBuffer | null>(null);
  const isRecordingRef = useRef(false);
  const startRecordingRef = useRef<(() => void) | null>(null);
  const greetingPlayedRef = useRef(false);

  const stopAudioPlayback = useCallback(() => {
    if (outputAudioContextRef.current) {
        audioSourcesRef.current.forEach(source => {
            try { source.stop(); } catch (e) { /* Ignore */ }
        });
        audioSourcesRef.current.clear();
        nextStartTimeRef.current = 0;
    }
    setIsSpeaking(false);
  }, []);

  const cleanup = useCallback(async () => {
    if (stalemateTimerRef.current) clearTimeout(stalemateTimerRef.current);
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    stopAudioPlayback();

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch (e) {
        console.error("Error stopping media recorder:", e);
      }
      mediaRecorderRef.current = null;
    }

    if (microphoneStreamRef.current) {
        microphoneStreamRef.current.getTracks().forEach(track => track.stop());
        microphoneStreamRef.current = null;
    }

    if (inputAudioContextRef.current && inputAudioContextRef.current.state !== 'closed') {
        await inputAudioContextRef.current.close();
        inputAudioContextRef.current = null;
    }

    if (outputAudioContextRef.current && outputAudioContextRef.current.state !== 'closed') {
        await outputAudioContextRef.current.close();
        outputAudioContextRef.current = null;
    }

    recordedChunksRef.current = [];
    isRecordingRef.current = false;
  }, [stopAudioPlayback]);
  
  const handleEndInterview = useCallback(async () => {
    await cleanup();
    onFinish(transcript);
  }, [cleanup, onFinish, transcript]);

  const handleEndInterviewRef = useRef(handleEndInterview);
  useEffect(() => {
      handleEndInterviewRef.current = handleEndInterview;
  }, [handleEndInterview]);
  
  const clearTimers = useCallback(() => {
    if (stalemateTimerRef.current) clearTimeout(stalemateTimerRef.current);
  }, []);

  const startInactivityTimer = useCallback(() => {
    clearTimers();
    stalemateTimerRef.current = setTimeout(() => {
      toast.info("Interview ended due to inactivity.");
      handleEndInterviewRef.current();
    }, 120000); // 2 minutes
  }, [clearTimers]);

  const getSystemInstruction = useCallback(() => {
    const jobDescriptionContext = jobDescription 
      ? `The candidate is applying for a role with this description: ${jobDescription}`
      : "";

    return `You are Alex, an adaptive AI Interviewer designed for Indian hiring contexts. You are conducting an interview for the "${jobRole}" position.

CRITICAL CONTEXT - YOU ALREADY KNOW:
- The candidate is interviewing for: "${jobRole}"
- ${jobDescription ? `Job Description: ${jobDescription}` : 'No specific job description provided, use general expectations for this role.'}
- DO NOT ask what role they're interviewing for - you already know it's "${jobRole}"
- DO NOT ask them to repeat information you already have
- Start directly with Phase 1 below

Your primary goal is to conduct a fluid, voice-to-voice conversation following a structured interview flow. Respond naturally to the user's speech and keep the dialogue flowing.

General Interview Behaviour (Applies to All Roles)
	•	KEEP QUESTIONS SHORT AND NATURAL - aim for 1-2 sentences maximum, like a real conversation
	•	Sound like a friendly human interviewer, not a robot reading a script
	•	Use casual, conversational language - say "Tell me about..." instead of "Could you please elaborate on..."
	•	Acknowledge what the candidate says briefly, then ask ONE focused question
	•	If the candidate pauses, give a gentle nudge like "Take your time" or "What do you think?"
	•	If answers are too long, politely interrupt with "That's great, let me ask you this..."
	•	If answers are too short, ask a simple, direct follow-up
	•	AVOID long, multi-part questions - ask one thing at a time
	•	AVOID formal language - be warm and approachable
	•	AVOID repeating what they said in detail - just acknowledge briefly
	•	Don't ask "Please share your thoughts in voice" - they're already speaking
	•	Track which phase you're in and progress systematically
	•	Move through phases in order: Phase 1 → Phase 2 → Phase 3 → Phase 4

STRUCTURED INTERVIEW FLOW - FOLLOW THIS EXACTLY IN ORDER:

PHASE 1: WARM-UP & BACKGROUND (2-3 questions)
	•	Greet them warmly
	•	Ask for a brief introduction about themselves and their background
	•	Ask about their relevant experience for the "${jobRole}" role
	•	Paraphrase what they said to show you're listening
	•	DO NOT ask what role they're applying for - you already know it's "${jobRole}"
	•	DO NOT ask if they can hear you clearly - just start the interview naturally

PHASE 2: CORE TECHNICAL/BEHAVIORAL QUESTIONS (5-6 questions)
	•	Ask role-specific questions tailored to "${jobRole}"
	•	Each question should build on their previous answers
	•	Probe deeper into their experience, skills, and approach
	•	Ask follow-up questions based on what they share
	•	For technical roles: focus on problem-solving, technical depth, and approach
	•	For design/PM roles: focus on user understanding, process, and decision-making
	•	For management roles: focus on leadership, conflict resolution, and team dynamics

PHASE 3: PRACTICAL TASK/SCENARIO (1 task)
	•	Give them a role-appropriate challenge:
		- For Designers: Design task or whiteboarding challenge
		- For Engineers: Coding problem or system design
		- For PMs: Case study or prioritization scenario
		- For Managers: Leadership scenario or conflict resolution
	•	Let them think aloud and guide them if they're stuck
	•	Ask follow-up questions about their approach

PHASE 4: REFLECTIVE & CLOSING (2-3 questions)
	•	Ask what they'd do differently in a past project
	•	Ask how they measure success in their work
	•	Ask if they have any questions for you
	•	Thank them and let them know the interview is complete

⸻

ROLE-SPECIFIC QUESTION GUIDELINES - Use these for Phase 2 questions:

🟦 For UX/UI/Product Designer roles:
	•	Ask about their design process and how they approach user research
	•	Focus on user understanding, problem framing, and reasoning behind design decisions
	•	Ask about handling constraints (time, tech, India-specific users)
	•	Probe their understanding of metrics for design success
	•	For Phase 3: Give a design/whiteboarding task - ask them to think aloud, use Figma/FigJam/Miro, and upload a screenshot
	•	Guide them to define user & problem, outline flows, propose simple solutions

🟩 For Product Manager (PM) roles:
	•	Ask about their approach to problem identification and user understanding
	•	Focus on prioritization frameworks and execution thinking
	•	Probe their understanding of metrics (North Star + input metrics)
	•	Ask about handling India-context constraints (low data, COD, multilingual users)
	•	For Phase 3: Give a case study - ask for Problem → User → Assumptions → Metrics → Execution outline
	•	Push for measurable metrics and outcomes, not just features

🟥 For Software Engineer (SDE) roles:
	•	Ask about their problem-solving approach and coding methodology
	•	Focus on structured thinking, logic clarity, and complexity analysis
	•	Probe their debugging process and communication style
	•	Ask about their experience with algorithms, data structures, and system design
	•	For Phase 3: Give a coding problem or system design challenge
	•	Let them explain steps aloud (pseudocode or verbal logic is fine)
	•	Follow up with complexity, edge cases, and improvements

🟧 For Engineering Manager (EM) roles:
	•	Ask about leadership decisions and team management
	•	Focus on conflict resolution, mentoring, and execution
	•	Probe their technical understanding (but don't ask them to code)
	•	Ask scenario-based questions about handling difficult situations
	•	For Phase 3: Give a leadership scenario or conflict resolution case

🟨 For Data Analyst/Data Scientist roles:
	•	Ask about their approach to data analysis and model building
	•	Focus on intuition behind metrics/models and simplifying complex ideas
	•	Probe their understanding of real-world data constraints (especially Indian context)
	•	Ask practical cases about retention, churn, A/B testing
	•	For Phase 3: Give a data analysis scenario or modeling challenge

🟪 For Marketing/Growth roles:
	•	Ask about funnel thinking and campaign execution
	•	Focus on execution speed and creativity grounded in Indian user behavior
	•	Probe their understanding of measurable impact and metrics
	•	Ask about campaign-based scenarios and hypothesis testing
	•	For Phase 3: Give a marketing campaign scenario or growth challenge

⸻

GUIDANCE FOR CHALLENGES (ALL ROLES)

Whiteboarding
	•	Ask them to think aloud
	•	Use Figma / FigJam / Miro
	•	Upload screenshot here
	•	Explain in 2 minutes

Coding
	•	Speak logic
	•	Pseudocode acceptable
	•	Short problem, ask follow-ups

Case Interview
	•	Ask structured explanation
	•	Push for assumptions + metrics

Behavioural
	•	Encourage STAR method
	•	Ask follow-up on outcome

⸻

ADAPTATION LOGIC
	•	If candidate is stuck: give a small hint, not the solution.
	•	If candidate rambles: summarize and move on.
	•	If candidate speaks too little: ask a narrower follow-up.
	•	If answer doesn't fit the question: gently redirect.
	•	If they misunderstand the task: restate in simpler words.

IMPORTANT REMINDERS:
	•	You already know the role is "${jobRole}" - NEVER ask what role they're applying for
	•	You already know the job description (if provided) - use it to tailor your questions
	•	Follow the phase structure: Warm-up → Core Questions → Task → Closing
	•	Ask role-specific questions from the start - don't ask generic questions
	•	Build on their answers - each question should reference what they said before
	•	Keep the conversation natural and flowing, but stay within the structured phases

QUESTION STYLE EXAMPLES:
	❌ BAD (too long, robotic): "That sounds like valuable experience, Rohit. So, in your mobile app redesign project, you were a key contributor, handling user research, wireframing, and prototyping. Could you elaborate on your user research process for that project? How did you identify user needs and pain points, especially considering the Indian user context, and how did that research directly influence your design decisions for the mobile app? Please share your approach in voice."

	✅ GOOD (short, natural): "That's great! Tell me more about your user research process for that mobile app. How did you identify what users needed?"

	❌ BAD: "Could you please provide a detailed explanation of your approach to problem-solving in the context of software development?"

	✅ GOOD: "How do you usually approach solving a coding problem?"

Remember: Sound like a friendly colleague asking questions, not a formal interviewer reading from a script.`;
  }, [jobRole, jobDescription]);

  const playAudioFromBuffer = useCallback(async (audioBuffer: ArrayBuffer) => {
    if (!outputAudioContextRef.current) return;

    try {
      const context = outputAudioContextRef.current;
      const analyser = analyserNodeRef.current!;
      
      // Stop recording when AI starts speaking
      if (isRecordingRef.current && mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
        isRecordingRef.current = false;
        setIsListening(false);
      }
      
      setIsSpeaking(true);
      // Eleven Labs returns MP3, which AudioContext.decodeAudioData can handle directly
      const buffer = await context.decodeAudioData(audioBuffer.slice(0));
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(analyser);
      
      nextStartTimeRef.current = Math.max(nextStartTimeRef.current, context.currentTime);
      source.start(nextStartTimeRef.current);
      nextStartTimeRef.current += buffer.duration;
      audioSourcesRef.current.add(source);
      
      source.onended = () => {
        audioSourcesRef.current.delete(source);
        if (audioSourcesRef.current.size === 0) {
          setIsSpeaking(false);
          startInactivityTimer();
          // Restart recording after AI finishes speaking (immediate restart)
          setTimeout(() => {
            if (sessionState === 'active' && !isProcessing && !isRecordingRef.current && startRecordingRef.current) {
              startRecordingRef.current();
            }
          }, 100);
        }
      };
    } catch (e) {
      console.error("Error playing audio:", e);
      setIsSpeaking(false);
      startInactivityTimer();
    }
  }, [startInactivityTimer, sessionState, isProcessing]);

  const processUserMessage = useCallback(async (text: string, imageData?: { data: string; mimeType: string }) => {
    if (!chatServiceRef.current) return;

    try {
      setIsProcessing(true);
      clearTimers();
      isRecordingRef.current = false; // Stop recording while processing

      // Add user message to transcript
      const userEntry: TranscriptEntry = { speaker: 'user', text: text.trim() };
      if (imageData) {
        userEntry.imageUrl = `data:${imageData.mimeType};base64,${imageData.data}`;
      }
      setTranscript(prev => [...prev, userEntry]);

      // Get AI response
      const responseText = await chatServiceRef.current.sendMessage(text, imageData);
      
      // Generate audio in parallel with showing text (don't wait for audio to show text)
      // But start audio generation immediately
      const audioPromise = chatServiceRef.current.generateAudio(responseText);
      
      // Add AI response to transcript immediately (text shows right away)
      setTranscript(prev => [...prev, { speaker: 'ai', text: responseText }]);

      // Wait for audio and play it
      const audioBuffer = await audioPromise;
      await playAudioFromBuffer(audioBuffer);

    } catch (error: any) {
      console.error('Error processing message:', error);
      toast.error(error.message || "Failed to process your message. Please try again.");
      setIsProcessing(false);
      // Restart recording after error (faster restart)
      setTimeout(() => {
        if (sessionState === 'active' && !isProcessing && startRecordingRef.current) {
          startRecordingRef.current();
        }
      }, 300);
    } finally {
      setIsProcessing(false);
    }
  }, [clearTimers, playAudioFromBuffer, sessionState]);

  const startSession = useCallback(async () => {
    setSessionState('starting');

    try {
      // Request microphone permission
      await navigator.mediaDevices.getUserMedia({ audio: true }).then(s => s.getTracks().forEach(t => t.stop()));

      // Initialize audio context for output
      const context = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      await context.resume();
      outputAudioContextRef.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyserNodeRef.current = analyser;
      analyser.connect(context.destination);

      // Initialize chat service
      const apiKey = (import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.GEMINI_API_KEY || import.meta.env.API_KEY) as string;
      if (!apiKey) {
        throw new Error('Gemini API key is not configured. Please ensure VITE_GEMINI_API_KEY is set in your environment variables.');
      }
      chatServiceRef.current = new GeminiChatService(apiKey, getSystemInstruction());

      // Generate greeting using Eleven Labs TTS for faster audio
      const greetingText = `Hello! I'm Alex, and we're here today to interview for the ${jobRole} position. Could you tell me a little about yourself and your background?`;
      
      const { generateSpeech } = await import('../utils/elevenTts');
      greetingAudioBufferRef.current = await generateSpeech(greetingText);
      greetingPlayedRef.current = false; // Reset flag for new session
      
      setTranscript([{ speaker: 'ai', text: greetingText }]);
      setSessionState('active');
    } catch (error: any) {
      console.error('Initialization failed:', error);
      setErrorMessage(error.message || "Failed to connect to the interview service. Please check your connection and try again.");
      setSessionState('error');
    }
  }, [jobRole, getSystemInstruction]);

  const handleStartSessionClick = useCallback(async () => {
    if (sessionState === 'error') {
      await cleanup();
      setTranscript([]);
    }
    startSession();
  }, [sessionState, cleanup, startSession]);

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setImageFile(file);
      try {
        const previewUrl = await fileToBase64(file);
        setImagePreview(previewUrl);
      } catch (error) {
        toast.error("Could not load image preview.");
        console.error(error);
      }
    }
  };

  const handleSend = async () => {
    if (!textInput.trim() && !imageFile) return;

    let imageData: { data: string; mimeType: string } | undefined;
    if (imageFile && imagePreview) {
      const base64Data = imagePreview.split(',')[1];
      imageData = {
        data: base64Data,
        mimeType: imageFile.type
      };
    }

    await processUserMessage(textInput.trim(), imageData);

    setTextInput('');
    setImageFile(null);
    setImagePreview(null);
  };

  const handleCodeSubmit = useCallback((code: string, language: SupportedLanguage, output?: string) => {
    const codeEntry: TranscriptEntry = {
      speaker: 'user',
      text: `[CODE SUBMISSION - ${language.toUpperCase()}]`,
      codeSnippet: {
        code,
        language,
        output,
      },
    };
    setTranscript(prev => [...prev, codeEntry]);
    setShowCodeEditor(false);
    
    // Send code to AI for analysis
    const codeMessage = `I've written the following ${language} code:\n\n\`\`\`${language}\n${code}\n\`\`\`${output ? `\n\nOutput:\n${output}` : ''}\n\nPlease review my solution and provide feedback.`;
    processUserMessage(codeMessage);
  }, [processUserMessage]);

  const detectSilence = useCallback(() => {
    if (!inputAnalyserRef.current || !isRecordingRef.current || isProcessing) return;

    const analyser = inputAnalyserRef.current;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(dataArray);

    // Calculate average volume
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
      const normalized = (dataArray[i] - 128) / 128;
      sum += Math.abs(normalized);
    }
    const average = sum / bufferLength;
    const threshold = 0.01; // Adjust this to be more/less sensitive

    if (average > threshold) {
      // Sound detected, reset silence timer
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = setTimeout(() => {
        // 0.8 seconds of silence - stop recording (much faster response)
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
        }
      }, 800);
    }

    // Continue monitoring
    if (isRecordingRef.current) {
      requestAnimationFrame(detectSilence);
    }
  }, [isProcessing]);

  const startContinuousRecording = useCallback(async () => {
    if (isProcessing || isRecordingRef.current || isSpeaking) return;
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000
        } 
      });
      microphoneStreamRef.current = stream;

      // Create audio context for silence detection
      const inputContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      inputAudioContextRef.current = inputContext;
      const source = inputContext.createMediaStreamSource(stream);
      const analyser = inputContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.8;
      inputAnalyserRef.current = analyser;
      source.connect(analyser);

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });
      mediaRecorderRef.current = mediaRecorder;
      recordedChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        isRecordingRef.current = false;
        setIsListening(false);
        
        if (recordedChunksRef.current.length === 0) {
          // Restart recording if no audio was captured (immediate restart)
          setTimeout(() => startContinuousRecording(), 100);
          return;
        }

        try {
          setIsProcessing(true);
          const audioBlob = new Blob(recordedChunksRef.current, { type: 'audio/webm;codecs=opus' });
          
          // Validate minimum recording length (reduced threshold for faster processing)
          if (audioBlob.size < 500) {
            setIsProcessing(false);
            recordedChunksRef.current = [];
            // Restart recording (immediate restart)
            setTimeout(() => startContinuousRecording(), 100);
            return;
          }
          
          // Transcribe audio
          const transcription = await transcribeAudio(audioBlob);
          
          if (transcription.trim()) {
            await processUserMessage(transcription);
          } else {
            setIsProcessing(false);
            recordedChunksRef.current = [];
            // Restart recording (immediate restart)
            setTimeout(() => startContinuousRecording(), 100);
          }
        } catch (error: any) {
          console.error('Error transcribing audio:', error);
          toast.error(error.message || "Failed to transcribe audio. Please try again.");
          setIsProcessing(false);
          recordedChunksRef.current = [];
          // Restart recording after error (faster restart)
          setTimeout(() => startContinuousRecording(), 300);
        }
      };

      mediaRecorder.start();
      isRecordingRef.current = true;
      setIsListening(true);
      
      // Start silence detection
      detectSilence();
    } catch (error: any) {
      console.error('Error starting recording:', error);
      toast.error("Could not access microphone. Please grant permission.");
      setIsListening(false);
    }
  }, [isProcessing, isSpeaking, detectSilence, processUserMessage]);

  useEffect(() => {
    // Store the recording function reference
    startRecordingRef.current = startContinuousRecording;
  }, [startContinuousRecording]);

  useEffect(() => {
    // Only play greeting once when session becomes active
    if (sessionState === 'active' && greetingAudioBufferRef.current && outputAudioContextRef.current && !greetingPlayedRef.current) {
      greetingPlayedRef.current = true;
      playAudioFromBuffer(greetingAudioBufferRef.current).then(() => {
        // Start continuous recording after greeting finishes (immediate start)
        setTimeout(() => {
          if (startRecordingRef.current) {
            startRecordingRef.current();
          }
        }, 100);
      });
    }
  }, [sessionState, playAudioFromBuffer]);

  useEffect(() => {
    return () => { cleanup(); };
  }, [cleanup]);
  
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript]);

  if (sessionState !== 'active') {
    let buttonText = "Start Session";
    let message = "Click the button to begin your interview.";
    if (sessionState === 'starting') {
      buttonText = "Initializing...";
      message = "Please wait, Alex is getting ready.";
    }
    if (sessionState === 'error') {
      buttonText = "Retry";
      message = errorMessage;
    }
    return (
        <div className="flex flex-col items-center justify-center h-screen bg-white p-4 sm:p-6 lg:p-8">
            <div className="text-center">
                <h2 className="text-2xl font-semibold mb-4">Interview for: <span className="font-bold text-blue-600">{jobRole}</span></h2>
                <p className="text-gray-600 mb-8 max-w-sm">{message}</p>
                <button
                    onClick={handleStartSessionClick}
                    disabled={sessionState === 'starting'}
                    className="px-8 py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-wait text-white font-bold rounded-lg transition-colors text-xl"
                >
                    {buttonText}
                </button>
            </div>
        </div>
    );
  }

  return (
    <div className="h-screen bg-white text-gray-900 flex flex-col">
      <div className="flex-shrink-0 flex justify-between items-center p-4 sm:p-6 lg:p-8 lg:pb-4">
          <h2 className="text-xl font-semibold">Interview for: <span className="font-bold text-blue-600">{jobRole}</span></h2>
          <button
            onClick={handleEndInterview}
            className="px-4 py-2 bg-gray-200 hover:bg-red-500 hover:text-white text-gray-700 font-bold rounded-lg transition-colors"
          >
            End Interview
          </button>
        </div>
      <div className="flex-1 flex flex-col lg:flex-row gap-6 min-h-0 px-4 sm:px-6 lg:px-8 pb-4 sm:pb-6 lg:pb-8">
          <div className={`flex flex-col items-center justify-center bg-white rounded-lg p-6 border lg:w-1/3 transition-all duration-300 ${isSpeaking ? 'border-blue-500 shadow-xl shadow-blue-500/20' : 'border-gray-200'}`}>
            <Avatar isSpeaking={isSpeaking} analyserNode={analyserNodeRef.current} />
            <p className="mt-6 text-xl font-medium text-gray-900">Alex, The Interviewer</p>
            <div className={`mt-2 text-sm font-medium transition-colors ${isSpeaking ? 'text-blue-600' : isListening ? 'text-green-600' : isProcessing ? 'text-yellow-600' : 'text-gray-500'}`}>
              {isSpeaking ? 'Speaking...' : isListening ? 'Listening...' : isProcessing ? 'Processing...' : 'Ready'}
            </div>
          </div>
          <div className="flex-1 lg:w-2/3 bg-white rounded-lg border border-gray-200 flex flex-col min-h-0">
            <div className="p-6 border-b border-gray-200 flex-shrink-0">
                <h3 className="text-xl font-bold text-gray-900">Live Transcript</h3>
            </div>
            <div className="transcript-container flex-1 overflow-y-auto p-6 space-y-4">
              {transcript.map((entry, index) => (
                <div key={index} className={`flex flex-col animate-fade-in-up ${entry.speaker === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={`max-w-xl rounded-2xl ${entry.speaker === 'user' ? 'bg-blue-600 text-white rounded-br-lg' : 'bg-gray-100 text-gray-900 rounded-bl-lg'}`}>
                    {entry.text && <p className="text-base px-4 py-3 whitespace-pre-wrap">{entry.text}</p>}
                    {entry.imageUrl && <img src={entry.imageUrl} alt="User upload" className="max-w-xs rounded-lg p-2" />}
                    {entry.codeSnippet && (
                      <div className="px-4 py-3 bg-gray-900 rounded-lg m-2">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs text-gray-400 uppercase">{entry.codeSnippet.language}</span>
                          {entry.codeSnippet.output && (
                            <span className="text-xs text-green-400">✓ Executed</span>
                          )}
                        </div>
                        <pre className="text-sm text-gray-100 overflow-x-auto">
                          <code>{entry.codeSnippet.code}</code>
                        </pre>
                        {entry.codeSnippet.output && (
                          <div className="mt-3 pt-3 border-t border-gray-700">
                            <div className="text-xs text-gray-400 mb-1">Output:</div>
                            <pre className="text-sm text-green-400 whitespace-pre-wrap">{entry.codeSnippet.output}</pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <span className="text-xs text-gray-500 mt-1.5 px-1">{entry.speaker === 'user' ? 'You' : 'Alex'}</span>
                </div>
              ))}
              <div ref={transcriptEndRef} />
            </div>
            <div className="mt-auto p-6 border-t border-gray-200 flex-shrink-0">
                 <div className="flex justify-center items-center mb-4 h-12">
                    {isSpeaking ? (
                        <span className="text-gray-500 text-sm animate-fade-in">
                          Alex is speaking...
                        </span>
                    ) : isProcessing ? (
                        <span className="text-gray-500 text-sm animate-fade-in">
                          Processing your message...
                        </span>
                    ) : isListening ? (
                        <span className="text-green-600 text-sm animate-fade-in flex items-center gap-2">
                          <span className="relative flex h-3 w-3">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                          </span>
                          Listening... (speak naturally)
                        </span>
                    ) : (
                        <span className="text-gray-500 text-sm">
                          Ready to listen...
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowCodeEditor(!showCodeEditor)}
                      className="cursor-pointer p-2 rounded-full hover:bg-gray-200 transition-colors"
                      title="Open Code Editor"
                    >
                      <svg className="w-6 h-6 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                      </svg>
                    </button>
                    <label htmlFor="image-upload" className="cursor-pointer p-2 rounded-full hover:bg-gray-200 transition-colors">
                        <svg className="w-6 h-6 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                        <input id="image-upload" type="file" className="hidden" accept="image/*" onChange={handleImageChange} />
                    </label>
                    <div className="flex-1 relative">
                        {imagePreview && (
                            <div className="absolute bottom-12 left-0 p-1 bg-white border rounded-lg shadow-md">
                                <img src={imagePreview} alt="Preview" className="h-20 w-auto rounded" />
                                <button onClick={() => { setImageFile(null); setImagePreview(null); }} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full h-5 w-5 flex items-center justify-center text-xs">&times;</button>
                            </div>
                        )}
                        <input
                            type="text"
                            value={textInput}
                            onChange={(e) => setTextInput(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                            placeholder="Type a message or describe your image..."
                            disabled={isProcessing}
                            className="w-full px-4 py-3 bg-white border-2 border-gray-200 rounded-full text-base placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors disabled:bg-gray-100 disabled:cursor-not-allowed"
                        />
                    </div>
                    <button
                        onClick={handleSend}
                        disabled={(!textInput.trim() && !imageFile) || isProcessing}
                        className="p-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-full transition-all transform hover:scale-110 disabled:bg-gray-400 disabled:scale-100"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                    </button>
                </div>
            </div>
          </div>
      </div>
       <style>{`
            .transcript-container::-webkit-scrollbar {
                width: 8px;
            }
            .transcript-container::-webkit-scrollbar-track {
                background: #f1f1f1;
                border-radius: 10px;
            }
            .transcript-container::-webkit-scrollbar-thumb {
                background: #ccc;
                border-radius: 10px;
            }
            .transcript-container::-webkit-scrollbar-thumb:hover {
                background: #aaa;
            }
            @keyframes fade-in-up {
              from { opacity: 0; transform: translateY(10px); }
              to { opacity: 1; transform: translateY(0); }
            }
            .animate-fade-in-up { animation: fade-in-up 0.5s ease-out forwards; }
             @keyframes fade-in {
              from { opacity: 0; }
              to { opacity: 1; }
            }
            .animate-fade-in { animation: fade-in 0.3s ease-out forwards; }
      `}</style>
      {showCodeEditor && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h3 className="text-xl font-bold text-gray-900">Code Editor</h3>
              <button
                onClick={() => setShowCodeEditor(false)}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
              >
                <svg className="w-6 h-6 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-hidden p-4">
              <CodeEditor
                language={currentLanguage}
                initialCode={currentCode}
                onCodeChange={setCurrentCode}
                onCodeSubmit={handleCodeSubmit}
                height="calc(90vh - 120px)"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InterviewScreen;
