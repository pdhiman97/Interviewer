import React from 'react';
import SiriWave from './SiriWave';

interface AvatarProps {
  isSpeaking: boolean;
  analyserNode: AnalyserNode | null;
}

const Avatar: React.FC<AvatarProps> = ({ isSpeaking, analyserNode }) => {
  return (
    <div className="relative w-48 h-48 sm:w-64 sm:h-64 flex items-center justify-center">
      <SiriWave isSpeaking={isSpeaking} analyserNode={analyserNode} />
    </div>
  );
};

export default Avatar;