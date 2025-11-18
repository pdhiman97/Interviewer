interface Judge0Submission {
  language_id: number;
  source_code: string;
  stdin?: string;
}

interface Judge0Response {
  token: string;
}

interface Judge0Result {
  stdout: string | null;
  stderr: string | null;
  compile_output: string | null;
  message: string | null;
  status: {
    id: number;
    description: string;
  };
  time: string | null;
  memory: number | null;
}

// Language IDs for Judge0
export const LANGUAGE_IDS = {
  javascript: 63, // Node.js
  python: 71,     // Python 3
  java: 62,       // Java
  cpp: 54,        // C++17
  c: 50,          // C
  csharp: 51,     // C#
  go: 60,         // Go
  rust: 73,       // Rust
  php: 68,        // PHP
  ruby: 72,       // Ruby
  swift: 83,      // Swift
  kotlin: 78,     // Kotlin
  typescript: 74, // TypeScript
} as const;

export type SupportedLanguage = keyof typeof LANGUAGE_IDS;

const JUDGE0_API_URL = 'https://judge0-ce.p.rapidapi.com';

const getApiKey = (): string => {
  const apiKey = (
    (import.meta.env.VITE_JUDGE0_API_KEY as string) ||
    (import.meta.env.JUDGE0_API_KEY as string) ||
    '00a22cbfe8msh92dc20bfd02ccb9p127500jsn817a84b42127' // Fallback for backward compatibility
  )?.trim();
  
  if (!apiKey || apiKey === 'undefined' || apiKey === 'null') {
    throw new Error('Judge0 API key is not configured. Please ensure VITE_JUDGE0_API_KEY is set in your environment variables.');
  }
  
  return apiKey;
};

export const executeCode = async (
  code: string,
  language: SupportedLanguage,
  stdin?: string
): Promise<{ output: string; error: string | null; status: string }> => {
  const languageId = LANGUAGE_IDS[language];
  const API_KEY = getApiKey();

  try {
    // Submit code
    const submitResponse = await fetch(`${JUDGE0_API_URL}/submissions?base64_encoded=false&wait=false`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-RapidAPI-Key': API_KEY,
        'X-RapidAPI-Host': 'judge0-ce.p.rapidapi.com',
      },
      body: JSON.stringify({
        language_id: languageId,
        source_code: code,
        stdin: stdin || '',
      } as Judge0Submission),
    });

    if (!submitResponse.ok) {
      throw new Error(`Submission failed: ${submitResponse.statusText}`);
    }

    const submission: Judge0Response = await submitResponse.json();
    const token = submission.token;

    // Poll for result (with timeout)
    const maxAttempts = 30;
    let attempts = 0;

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second

      const resultResponse = await fetch(
        `${JUDGE0_API_URL}/submissions/${token}?base64_encoded=false`,
        {
          headers: {
            'X-RapidAPI-Key': API_KEY,
            'X-RapidAPI-Host': 'judge0-ce.p.rapidapi.com',
          },
        }
      );

      if (!resultResponse.ok) {
        throw new Error(`Failed to get result: ${resultResponse.statusText}`);
      }

      const result: Judge0Result = await resultResponse.json();

      // Status 1 = In Queue, Status 2 = Processing
      if (result.status.id === 1 || result.status.id === 2) {
        attempts++;
        continue;
      }

      // Status 3 = Accepted
      const output = result.stdout || '';
      const error = result.stderr || result.compile_output || result.message || null;
      const status = result.status.description;

      return {
        output: output.trim(),
        error: error ? error.trim() : null,
        status,
      };
    }

    throw new Error('Execution timeout: Code took too long to execute');
  } catch (error: any) {
    console.error('Code execution error:', error);
    return {
      output: '',
      error: error.message || 'Failed to execute code',
      status: 'Error',
    };
  }
};

