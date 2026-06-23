import type { TenantProfile } from './types';

/**
 * Default clinical details keyed by the original room IDs.
 * For renamed/custom rooms, a generic default is used.
 */
const TENANT_DETAILS: Record<
  string,
  {
    id: string;
    age: number;
    dob: string;
    description: string;
    vitals: TenantProfile['vitals'];
    allergies: string[];
    codeStatus: TenantProfile['codeStatus'];
  }
> = {
  room1: {
    id: 'T-100201',
    age: 82,
    dob: '06/14/1943',
    description:
      'Mr. Anderson is a long-term care resident admitted for management of chronic heart failure and mild cognitive impairment. He requires assistance with ADLs and benefits from daily wellness checks. He enjoys listening to jazz music and often asks about his grandchildren.',
    vitals: {
      heartRate: 78,
      bloodPressure: '156/85',
      temperature: 101.2,
      pulse: 78,
      spo2: 95,
    },
    allergies: ['Penicillin', 'Sulfa Drugs', 'Latex'],
    codeStatus: 'Full Code',
  },
  room2: {
    id: 'T-100202',
    age: 76,
    dob: '03/22/1949',
    description:
      'Mr. Brown is a retired schoolteacher residing in long-term care due to progressive COPD and early-stage dementia. He is generally cooperative and enjoys morning walks in the hallway when feeling well.',
    vitals: {
      heartRate: 82,
      bloodPressure: '142/78',
      temperature: 98.4,
      pulse: 82,
      spo2: 93,
    },
    allergies: ['Aspirin'],
    codeStatus: 'Full Code',
  },
  room3: {
    id: 'T-100203',
    age: 88,
    dob: '11/02/1937',
    description:
      'Mr. Davis is a long-term care resident with a history of Type 2 diabetes and peripheral neuropathy. He requires insulin management and foot care. He is soft-spoken and values his privacy.',
    vitals: {
      heartRate: 70,
      bloodPressure: '138/82',
      temperature: 98.6,
      pulse: 70,
      spo2: 96,
    },
    allergies: ['Codeine', 'Iodine'],
    codeStatus: 'DNR',
  },
  room4: {
    id: 'T-100204',
    age: 79,
    dob: '07/18/1946',
    description:
      'Mrs. Davis is recovering from a hip replacement surgery. She is determined to regain mobility and participates actively in physical therapy. She enjoys reading romance novels and chatting with staff.',
    vitals: {
      heartRate: 74,
      bloodPressure: '130/76',
      temperature: 98.8,
      pulse: 74,
      spo2: 97,
    },
    allergies: ['Morphine'],
    codeStatus: 'Full Code',
  },
  room5: {
    id: 'T-100205',
    age: 91,
    dob: '01/30/1935',
    description:
      "Mr. Jones is one of the oldest residents. He has moderate Alzheimer's disease and requires redirection and patience. He was a WWII history enthusiast and responds well to reminiscence therapy.",
    vitals: {
      heartRate: 68,
      bloodPressure: '148/90',
      temperature: 98.2,
      pulse: 68,
      spo2: 94,
    },
    allergies: ['Penicillin', 'Eggs'],
    codeStatus: 'DNR',
  },
  room6: {
    id: 'T-100206',
    age: 84,
    dob: '09/05/1941',
    description:
      'Mrs. Miller is a long-term care resident with congestive heart failure and chronic kidney disease Stage 3. She is social and enjoys card games with other residents. She requires fluid restriction monitoring.',
    vitals: {
      heartRate: 80,
      bloodPressure: '150/88',
      temperature: 99.0,
      pulse: 80,
      spo2: 95,
    },
    allergies: ['Sulfa Drugs', 'Shellfish'],
    codeStatus: 'Full Code',
  },
};

const GENERIC_DEFAULTS = {
  id: 'T-000000',
  age: 75,
  dob: '01/01/1950',
  description: 'No profile available.',
  vitals: {
    heartRate: 72,
    bloodPressure: '120/80',
    temperature: 98.6,
    pulse: 72,
    spo2: 97,
  },
  allergies: [] as string[],
  codeStatus: 'Full Code' as const,
};

/**
 * Build a TenantProfile from DB room config.
 * Falls back to hardcoded clinical details for original room1–room6,
 * or generic defaults for custom/renamed rooms.
 */
export function buildTenantProfile(
  roomId: string,
  config: {
    patientName: string;
    patientGender: 'male' | 'female';
    patientAge: number;
    patientProfile: string;
    caregiverName: string;
  },
): TenantProfile {
  const details = TENANT_DETAILS[roomId] ?? GENERIC_DEFAULTS;

  return {
    id: details.id,
    name: config.patientName,
    age: config.patientAge ?? details.age,
    gender: config.patientGender,
    dob: details.dob,
    description: config.patientProfile || details.description,
    physician: `Dr. ${config.caregiverName}`,
    vitals: details.vitals,
    allergies: details.allergies,
    codeStatus: details.codeStatus,
    image: config.patientName ? `/characters/${config.patientName}.webp` : '',
    roomId,
  };
}

/**
 * Get a fallback TenantProfile when DB config is unavailable.
 * Uses generic defaults for unknown room IDs.
 */
export function getFallbackTenantProfile(roomId: string): TenantProfile {
  const details = TENANT_DETAILS[roomId] ?? GENERIC_DEFAULTS;

  return {
    ...details,
    name: 'Undeffined',
    gender: 'male',
    physician: 'Unknown',
    image: '',
    roomId,
  };
}
