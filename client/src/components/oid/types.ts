export interface TenantProfile {
  id: string;
  name: string;
  age: number;
  gender: 'male' | 'female';
  dob: string;
  physician: string;
  description: string;
  vitals: {
    heartRate: number;
    bloodPressure: string;
    temperature: number;
    pulse: number;
    spo2: number;
  };
  allergies: string[];
  codeStatus: 'Full Code' | 'DNR';
  image: string;
  roomId: string;
}

export interface SessionRecord {
  id: string;
  date: string;
  duration: string;
  status: 'Completed' | 'In Progress' | 'Failed';
  startTime?: string;
  endTime?: string;
  roomId?: string;
  sessionId?: string;
}
