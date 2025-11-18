export async function generateSpeech(text: string): Promise<ArrayBuffer> {
  // Check all possible environment variable names
  const apiKey = (
    (import.meta.env.VITE_ELEVEN_STT_API_KEY as string) ||
    (import.meta.env.ELEVEN_STT_API_KEY as string) ||
    (import.meta.env.VITE_ELEVENLABS_API_KEY as string) ||
    (import.meta.env.ELEVENLABS_API_KEY as string)
  )?.trim();
  
  // Debug logging - more detailed for production debugging
  const debugInfo = {
    hasViteElevenStt: !!import.meta.env.VITE_ELEVEN_STT_API_KEY,
    hasElevenStt: !!import.meta.env.ELEVEN_STT_API_KEY,
    hasViteElevenlabs: !!import.meta.env.VITE_ELEVENLABS_API_KEY,
    hasElevenlabs: !!import.meta.env.ELEVENLABS_API_KEY,
    apiKeyPresent: !!apiKey,
    apiKeyLength: apiKey?.length || 0,
    apiKeyPrefix: apiKey ? apiKey.substring(0, 10) + '...' : 'missing',
    envMode: import.meta.env.MODE,
    allEnvKeys: Object.keys(import.meta.env).filter(k => k.includes('ELEVEN') || k.includes('ELEVENLABS'))
  };
  console.log('Eleven Labs TTS - API Key check:', debugInfo);
  
  if (!apiKey || apiKey === 'undefined' || apiKey === 'null') {
    const errorMsg = `Eleven Labs API key is not configured. 
    
Checked environment variables:
- VITE_ELEVEN_STT_API_KEY: ${import.meta.env.VITE_ELEVEN_STT_API_KEY ? 'found' : 'missing'}
- ELEVEN_STT_API_KEY: ${import.meta.env.ELEVEN_STT_API_KEY ? 'found' : 'missing'}
- VITE_ELEVENLABS_API_KEY: ${import.meta.env.VITE_ELEVENLABS_API_KEY ? 'found' : 'missing'}
- ELEVENLABS_API_KEY: ${import.meta.env.ELEVENLABS_API_KEY ? 'found' : 'missing'}

Please ensure VITE_ELEVEN_STT_API_KEY is set in your Vercel environment variables and redeploy.`;
    throw new Error(errorMsg);
  }

  // Using "Rachel" - a natural, friendly female voice perfect for interviews
  // This voice has a warm, conversational quality
  const voiceId = "21m00Tcm4TlvDq8ikWAM"; // Rachel - natural, friendly female voice
  
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'Accept': 'audio/mpeg',
      'Content-Type': 'application/json',
      'xi-api-key': apiKey
    },
    body: JSON.stringify({
      text: text,
      model_id: "eleven_turbo_v2_5", // Fast model for low latency
      voice_settings: {
        stability: 0.3, // Lower for faster generation and more natural variation
        similarity_boost: 0.6, // Lower for faster processing
        style: 0.5, // Higher for more expressive, conversational delivery
        use_speaker_boost: true
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorData;
    try {
      errorData = JSON.parse(errorText);
    } catch {
      errorData = { message: errorText || response.statusText };
    }
    
    console.error('Eleven Labs TTS API error:', {
      status: response.status,
      errorData,
      apiKeyPresent: !!apiKey,
      apiKeyPrefix: apiKey ? apiKey.substring(0, 10) + '...' : 'missing'
    });
    
    if (response.status === 401) {
      // Check for specific error messages
      const detail = errorData?.detail;
      if (detail?.status === 'detected_unusual_activity') {
        throw new Error(`Eleven Labs Free Tier Disabled: ${detail.message}\n\nYour account has been restricted. Please:\n1. Visit https://elevenlabs.io/app/settings/subscription to upgrade to a paid plan, OR\n2. Contact Eleven Labs support if you believe this is an error`);
      }
      
      throw new Error(`Eleven Labs TTS API error: 401 Unauthorized. Please check:\n1. Your API key is valid at https://elevenlabs.io/app/settings/api-keys\n2. Your account has available credits\n3. You've restarted the dev server after updating .env.local`);
    }
    
    throw new Error(`Eleven Labs TTS API error: ${response.status} ${errorData?.detail?.message || errorData?.message || response.statusText}`);
  }

  const audioBlob = await response.blob();
  return await audioBlob.arrayBuffer();
}

