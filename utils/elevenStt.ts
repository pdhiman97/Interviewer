export async function transcribeAudio(audioBlob: Blob): Promise<string> {
    // Vite exposes VITE_ prefixed env vars via import.meta.env
    const apiKey = (
      (import.meta.env.VITE_ELEVEN_STT_API_KEY as string) ||
      (import.meta.env.ELEVEN_STT_API_KEY as string)
    )?.trim();
    
    if (!apiKey || apiKey === 'undefined' || apiKey === 'null') {
      console.error('Eleven Labs API key not found. Checked:', {
        importMetaVite: import.meta.env.VITE_ELEVEN_STT_API_KEY,
        importMeta: import.meta.env.ELEVEN_STT_API_KEY
      });
      throw new Error('Eleven Labs API key is not configured. Please check your .env file has VITE_ELEVEN_STT_API_KEY set and restart the dev server.');
    }

    // Validate audio blob
    if (!audioBlob || audioBlob.size === 0) {
      throw new Error('No audio data recorded. Please try speaking again.');
    }

    if (audioBlob.size < 1000) {
      throw new Error('Audio recording is too short. Please speak for at least 1-2 seconds.');
    }

    // Convert webm to a format Eleven Labs accepts (mp3 or wav)
    // For now, try sending webm with proper filename
    const formData = new FormData();
    
    // Try with .webm extension first, if that fails we'll convert
    const fileName = audioBlob.type.includes('webm') ? 'audio.webm' : 'audio.mp3';
    formData.append("file", audioBlob, fileName);
    // Use scribe_v2 as it's the latest stable model
    formData.append("model_id", "scribe_v2");
  
    console.log('Sending audio to Eleven Labs STT API:', {
      fileSize: audioBlob.size,
      fileType: audioBlob.type,
      fileName
    });
    
    const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: {
        "xi-api-key": apiKey
      },
      body: formData
    });
  
    if (!res.ok) {
      const errorText = await res.text();
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { message: errorText || res.statusText };
      }
      
      console.error('Eleven Labs API error response:', {
        status: res.status,
        statusText: res.statusText,
        errorData,
        errorText
      });
      
      if (res.status === 401) {
        throw new Error(`Eleven Labs API authentication failed (401). Please check that your API key is valid and restart the dev server if you just added it to .env`);
      }
      
      if (res.status === 400) {
        const errorMsg = errorData.detail?.message || errorData.message || errorData.error || 'Invalid request format';
        throw new Error(`Eleven Labs API error (400): ${errorMsg}. The audio format might not be supported. Please try recording again.`);
      }
      
      throw new Error(`Eleven Labs STT API error: ${res.status} ${errorData.message || errorData.error || res.statusText}`);
    }
  
    const data = await res.json();
  
    return data.text || "";
  }