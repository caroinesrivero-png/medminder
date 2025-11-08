
export interface Medication {
  id: string;
  name: string;
  dosage: string;
  time: string; // HH:MM format
  isTaken: boolean;
}

export interface JournalEntry {
  id: string;
  date: string; // ISO 8601 format
  content: string;
}

export interface ArchivedFile {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
}

export interface Appointment {
  id: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  specialty: string;
  location: string;
  notified: boolean;
}
