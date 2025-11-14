import React, { useState } from 'react';

interface SetupScreenProps {
  onStart: (jobRole: string, jobDescription?: string) => void;
}

const SetupScreen: React.FC<SetupScreenProps> = ({ onStart }) => {
  const [jobRole, setJobRole] = useState('');
  const [jobDescription, setJobDescription] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!jobRole.trim()) return;
    onStart(jobRole, jobDescription);
  };

  return (
    <div className="flex items-center justify-center h-screen bg-white p-4">
      <div className="text-center p-8 max-w-xl mx-auto w-full">
        <h1 className="text-5xl font-bold mb-4 text-gray-900">AI Interview Coach</h1>
        <p className="text-lg text-gray-600 mb-10">
          Practice your job interview with a realistic AI, get instant feedback, and sharpen your skills.
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col items-center gap-4">
          <input
            type="text"
            value={jobRole}
            onChange={(e) => setJobRole(e.target.value)}
            placeholder="Enter the job role, e.g., 'Software Engineer'"
            className="w-full px-4 py-3 bg-white border-2 border-gray-200 rounded-lg text-lg placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
            required
          />
          <textarea
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            placeholder="Optional: Paste job description for a more tailored interview"
            className="w-full px-4 py-3 bg-white border-2 border-gray-200 rounded-lg text-base placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors resize-y"
            rows={5}
          />
          <button
            type="submit"
            className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-lg rounded-lg transition-all transform hover:scale-105 disabled:bg-gray-400 disabled:scale-100"
            disabled={!jobRole.trim()}
          >
            Start Interview
          </button>
        </form>
      </div>
    </div>
  );
};

export default SetupScreen;