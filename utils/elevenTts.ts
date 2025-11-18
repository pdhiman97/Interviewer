export async function generateSpeech(text: string): Promise<ArrayBuffer> {
  const apiKey = (
    (import.meta.env.VITE_ELEVEN_STT_API_KEY as string) ||
    (import.meta.env.ELEVEN_STT_API_KEY as string)
  )?.trim();
  
  // Debug logging
  const debugInfo = {
    hasImportMetaEnv: !!import.meta.env.VITE_ELEVEN_STT_API_KEY,
    importMetaEnvValue: import.meta.env.VITE_ELEVEN_STT_API_KEY ? (import.meta.env.VITE_ELEVEN_STT_API_KEY as string).substring(0, 20) + '...' : 'missing',
    apiKeyPresent: !!apiKey,
    apiKeyLength: apiKey?.length || 0,
    apiKeyPrefix: apiKey ? apiKey.substring(0, 20) + '...' : 'missing',
    apiKeySuffix: apiKey ? '...' + apiKey.substring(apiKey.length - 10) : 'missing'
  };
  console.log('Eleven Labs TTS - API Key check:', debugInfo);
  
  if (!apiKey || apiKey === 'undefined' || apiKey === 'null') {
    throw new Error('Eleven Labs API key is not configured. Please ensure VITE_ELEVEN_STT_API_KEY is set in .env.local and restart the dev server.');
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

