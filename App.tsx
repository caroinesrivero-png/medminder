import React, { useState, useEffect, FormEvent, useMemo } from 'react';
import { Medication, JournalEntry, ArchivedFile, Appointment } from './types';
import { askAboutMedication, getMedicationInfo } from './services/geminiService';
import { useNotifications } from './hooks/useNotifications';

// Helper to generate unique IDs
const generateId = () => `id_${new Date().getTime()}_${Math.random().toString(36).substr(2, 9)}`;

// Helper to format date strings
const formatDate = (isoString: string) => {
    return new Date(isoString).toLocaleDateString('es-ES', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
};
const formatAppointmentDate = (dateString: string) => {
    const date = new Date(`${dateString}T00:00:00`);
     return date.toLocaleDateString('es-ES', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
}

// A2HS Event type (not standard in TS lib)
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}


// Main App Component
const App: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'reminders' | 'journal' | 'appointments' | 'archive'>('reminders');
    // Reminder States
    const [medications, setMedications] = useState<Medication[]>([]);
    const [formState, setFormState] = useState({ name: '', dosage: '', time: '' });
    const [notifiedIds, setNotifiedIds] = useState<Set<string>>(new Set());
    const [showPermissionBanner, setShowPermissionBanner] = useState(false);
    
    // Journal States
    const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
    const [newJournalEntry, setNewJournalEntry] = useState('');
    
    // Appointments States
    const [appointments, setAppointments] = useState<Appointment[]>([]);
    const [appointmentForm, setAppointmentForm] = useState({ date: '', time: '', specialty: '', location: '' });

    // Archive States
    const [archivedFiles, setArchivedFiles] = useState<ArchivedFile[]>([]);

    const { permission, requestPermission, showNotification } = useNotifications();

    // PWA Install Prompt State
    const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
    const [showInstallBanner, setShowInstallBanner] = useState(false);

    const [modalState, setModalState] = useState<{
        isOpen: boolean;
        medication: Medication | null;
        question: string;
        response: string;
        isLoading: boolean;
    }>({
        isOpen: false,
        medication: null,
        question: '',
        response: '',
        isLoading: false,
    });
    
    // Tooltip and Info Cache States
    const [medInfoCache, setMedInfoCache] = useState<Record<string, string>>({});
    const [tooltip, setTooltip] = useState<{
      medId: string | null;
      content: string;
      isLoading: boolean;
      position: { top: number; left: number };
    }>({
      medId: null,
      content: '',
      isLoading: false,
      position: { top: 0, left: 0 },
    });

    // --- PWA & DATA PERSISTENCE EFFECTS ---

    // Service Worker Registration and Install Prompt Listener
    useEffect(() => {
        // Register Service Worker
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/sw.js')
                    .then(reg => console.log('Service Worker registered.', reg))
                    .catch(err => console.error('Service Worker registration failed:', err));
            });
        }

        // Listen for 'beforeinstallprompt' event
        const handleBeforeInstallPrompt = (e: Event) => {
            e.preventDefault();
            setInstallPrompt(e as BeforeInstallPromptEvent);
            setShowInstallBanner(true); // Show custom install banner
        };
        
        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        };
    }, []);

    // Load data from localStorage on initial render
    useEffect(() => {
        try {
            const storedMeds = localStorage.getItem('medications');
            if (storedMeds) {
                setMedications(JSON.parse(storedMeds));
            }
            if (permission === 'default' && storedMeds && JSON.parse(storedMeds).length > 0) {
                setShowPermissionBanner(true);
            }

            const storedJournal = localStorage.getItem('journalEntries');
            if (storedJournal) {
                setJournalEntries(JSON.parse(storedJournal));
            }
            
            const storedFiles = localStorage.getItem('archivedFiles');
            if (storedFiles) {
                setArchivedFiles(JSON.parse(storedFiles));
            }
            
            const storedAppointments = localStorage.getItem('appointments');
            if (storedAppointments) {
                setAppointments(JSON.parse(storedAppointments));
            }
        } catch (error) {
            console.error("Failed to load data from localStorage", error);
        }
    }, [permission]);

    // Save medications to localStorage
    useEffect(() => {
        try {
            localStorage.setItem('medications', JSON.stringify(medications));
        } catch (error) {
            console.error("Failed to save medications to localStorage", error);
        }
    }, [medications]);

    // Save journal entries to localStorage
    useEffect(() => {
        try {
            localStorage.setItem('journalEntries', JSON.stringify(journalEntries));
        } catch (error) {
            console.error("Failed to save journal entries to localStorage", error);
        }
    }, [journalEntries]);

    // Save archived files to localStorage
    useEffect(() => {
        try {
            localStorage.setItem('archivedFiles', JSON.stringify(archivedFiles));
        } catch (error) {
            console.error("Failed to save archived files to localStorage", error);
        }
    }, [archivedFiles]);
    
    // Save appointments to localStorage
    useEffect(() => {
        try {
            localStorage.setItem('appointments', JSON.stringify(appointments));
        } catch (error) {
            console.error("Failed to save appointments to localStorage", error);
        }
    }, [appointments]);

    // --- REMINDER LOGIC ---

    // Daily Reset Effect
    useEffect(() => {
        const setDailyResetTimer = () => {
            const now = new Date();
            const midnight = new Date(
                now.getFullYear(),
                now.getMonth(),
                now.getDate() + 1, // Tomorrow
                0, 0, 5 // 5 seconds past midnight
            );
            const msUntilMidnight = midnight.getTime() - now.getTime();

            const timeoutId = setTimeout(() => {
                console.log("Resetting medications for the new day.");
                setMedications(currentMeds => 
                    currentMeds.map(med => ({ ...med, isTaken: false }))
                );
                setNotifiedIds(new Set());
                setDailyResetTimer(); 
            }, msUntilMidnight);

            return timeoutId;
        };

        const timeoutId = setDailyResetTimer();
        return () => clearTimeout(timeoutId);
    }, []);

    const isMedicationDue = (med: Medication): boolean => {
        if (med.isTaken) return false;
        const [hours, minutes] = med.time.split(':').map(Number);
        const now = new Date();
        const medTime = new Date(now);
        medTime.setHours(hours, minutes, 0, 0);
        return now > medTime;
    };

    // Medication Notification check useEffect
    useEffect(() => {
        if (permission !== 'granted') return;

        const interval = setInterval(() => {
            const dueMeds = medications.filter(med => isMedicationDue(med) && !notifiedIds.has(med.id));
            
            if (dueMeds.length > 0) {
                dueMeds.forEach(med => {
                    showNotification('⏰ ¡Hora de tu remedio!', {
                        body: `Es momento de tomar: ${med.name} ${med.dosage ? `(${med.dosage})` : ''}`,
                        requireInteraction: true,
                    });
                });
                setNotifiedIds(prev => new Set([...prev, ...dueMeds.map(m => m.id)]));
            }
        }, 30000); // Check every 30 seconds

        return () => clearInterval(interval);
    }, [medications, notifiedIds, permission, showNotification]);

    const sortedMedications = useMemo(() => {
        return [...medications].sort((a, b) => a.time.localeCompare(b.time));
    }, [medications]);

    const handleFormChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormState(prev => ({ ...prev, [name]: value }));
    };

    const addMedication = (e: FormEvent) => {
        e.preventDefault();
        if (formState.name && formState.time) {
            const newMed: Medication = {
                id: generateId(),
                name: formState.name,
                dosage: formState.dosage,
                time: formState.time,
                isTaken: false,
            };
            setMedications([...medications, newMed]);
            setFormState({ name: '', dosage: '', time: '' }); // Reset form
            
            if (permission === 'default') {
                setShowPermissionBanner(true);
            }
        }
    };
    
    const toggleMedicationTaken = (id: string) => {
        setMedications(meds =>
            meds.map(med => (med.id === id ? { ...med, isTaken: !med.isTaken } : med))
        );
    };

    const deleteMedication = (id: string) => {
        setMedications(meds => meds.filter(med => med.id !== id));
        if (tooltip.medId === id) {
            handleCloseTooltip();
        }
    };
    
    const handleAskClick = (medication: Medication) => {
        setModalState({
            isOpen: true,
            medication,
            question: '',
            response: '',
            isLoading: false,
        });
    };
    
    const handleModalClose = () => {
        setModalState(prev => ({ ...prev, isOpen: false }));
    };

    const handleQuestionSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!modalState.medication || !modalState.question) return;

        setModalState(prev => ({ ...prev, isLoading: true, response: '' }));
        const responseText = await askAboutMedication(modalState.medication.name, modalState.question);
        setModalState(prev => ({ ...prev, response: responseText, isLoading: false }));
    };

    const handleInfoClick = async (med: Medication, e: React.MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation(); 
        const rect = e.currentTarget.getBoundingClientRect();
        
        setTooltip({
            medId: med.id,
            content: '',
            isLoading: true,
            position: { top: rect.bottom + window.scrollY + 5, left: rect.left + window.scrollX },
        });

        if (medInfoCache[med.name]) {
            setTooltip(prev => ({ ...prev, content: medInfoCache[med.name], isLoading: false }));
            return;
        }

        const info = await getMedicationInfo(med.name);
        setMedInfoCache(prev => ({ ...prev, [med.name]: info }));
        setTooltip(prev => ({ ...prev, content: info, isLoading: false }));
    };

    const handleCloseTooltip = () => {
        setTooltip({ medId: null, content: '', isLoading: false, position: { top: 0, left: 0 } });
    };

    // --- PWA INSTALL HANDLER ---
    const handleInstallClick = async () => {
        if (!installPrompt) return;
        installPrompt.prompt();
        const { outcome } = await installPrompt.userChoice;
        console.log(`User response to the install prompt: ${outcome}`);
        setInstallPrompt(null);
        setShowInstallBanner(false);
    };

    // --- JOURNAL LOGIC ---
    
    const addJournalEntry = (e: FormEvent) => {
        e.preventDefault();
        if (newJournalEntry.trim()) {
            const newEntry: JournalEntry = {
                id: generateId(),
                date: new Date().toISOString(),
                content: newJournalEntry,
            };
            setJournalEntries([newEntry, ...journalEntries]);
            setNewJournalEntry('');
        }
    };
    
    const sortedJournalEntries = useMemo(() => {
        return [...journalEntries].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [journalEntries]);

    // --- APPOINTMENTS LOGIC ---

    // Appointment notification check
    useEffect(() => {
        if (permission !== 'granted') return;

        const interval = setInterval(() => {
            const now = new Date();
            const twentyFourHoursFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

            const upcomingAppointments = appointments.filter(appt => {
                if (appt.notified) return false;
                const apptDateTime = new Date(`${appt.date}T${appt.time}`);
                return apptDateTime > now && apptDateTime <= twentyFourHoursFromNow;
            });

            if (upcomingAppointments.length > 0) {
                upcomingAppointments.forEach(appt => {
                    showNotification('🗓️ Recordatorio de Turno', {
                        body: `Mañana tienes un turno de ${appt.specialty} a las ${appt.time}.`,
                        requireInteraction: true,
                    });
                });

                setAppointments(prev =>
                    prev.map(appt =>
                        upcomingAppointments.find(up => up.id === appt.id)
                            ? { ...appt, notified: true }
                            : appt
                    )
                );
            }
        }, 5 * 60 * 1000); // Check every 5 minutes

        return () => clearInterval(interval);
    }, [appointments, permission, showNotification]);


    const handleAppointmentFormChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setAppointmentForm(prev => ({ ...prev, [name]: value }));
    };
    
    const addAppointment = (e: FormEvent) => {
        e.preventDefault();
        const { date, time, specialty, location } = appointmentForm;
        if (date && time && specialty && location) {
            const newAppointment: Appointment = {
                id: generateId(),
                ...appointmentForm,
                notified: false
            };
            setAppointments(prev => [...prev, newAppointment]);
            setAppointmentForm({ date: '', time: '', specialty: '', location: '' });
        }
    };

    const deleteAppointment = (id: string) => {
        setAppointments(prev => prev.filter(appt => appt.id !== id));
    };

    const sortedAppointments = useMemo(() => {
        const now = new Date();
        now.setHours(0,0,0,0); // Start of today for comparison

        return [...appointments]
            .filter(appt => new Date(appt.date) >= now) // Filter out past appointments
            .sort((a, b) => {
                const dateA = new Date(`${a.date}T${a.time}`).getTime();
                const dateB = new Date(`${b.date}T${b.time}`).getTime();
                return dateA - dateB;
            });
    }, [appointments]);


    // --- ARCHIVE LOGIC ---

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files) return;

        // FIX: Replaced for...of loop with an indexed loop to correctly type `file` as `File` and prevent type errors.
        for (let i = 0; i < files.length; i++) {
            const file = files.item(i);
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    const newFile: ArchivedFile = {
                        id: generateId(),
                        name: file.name,
                        mimeType: file.type,
                        dataUrl: event.target?.result as string,
                    };
                    setArchivedFiles(prev => [...prev, newFile]);
                };
                reader.readAsDataURL(file);
            }
        }
        e.target.value = ''; // Allow uploading the same file again
    };

    const deleteFile = (id: string) => {
        setArchivedFiles(files => files.filter(file => file.id !== id));
    };

    const FileIcon: React.FC<{ mimeType: string }> = ({ mimeType }) => {
        if (mimeType.startsWith('image/')) {
            return (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-blue-500 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
                </svg>
            );
        }
        if (mimeType === 'application/pdf') {
            return (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-red-500 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M5.523 3.523A2.25 2.25 0 017.773 2H14.25a2.25 2.25 0 012.25 2.25v11.5a2.25 2.25 0 01-2.25 2.25H5.75a2.25 2.25 0 01-2.25-2.25V7.773c0-.817.474-1.555 1.223-1.93l3.6-1.8a.75.75 0 01.954.717V12a1 1 0 102 0V6a1 1 0 10-2 0v.18a.75.75 0 01-1.43.434l-3.6-1.8a.75.75 0 01-.22-.531z" />
                   <path fillRule="evenodd" d="M3 10a.75.75 0 01.75-.75h.01a.75.75 0 010 1.5H3.75A.75.75 0 013 10zm0-2.25a.75.75 0 01.75-.75h3.01a.75.75 0 010 1.5H3.75A.75.75 0 013 7.75zM3 12.25a.75.75 0 01.75-.75h3.01a.75.75 0 010 1.5H3.75A.75.75 0 01-.75-.75zM4.75 6a.75.75 0 01.75-.75h.01a.75.75 0 010 1.5H5.5a.75.75 0 01-.75-.75z" clipRule="evenodd" />
                </svg>
            );
        }
        return (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-gray-500 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
            </svg>
        );
    };

    return (
        <div className="min-h-screen bg-gray-50 font-sans p-4 sm:p-6 lg:p-8" onClick={handleCloseTooltip}>
             {tooltip.medId && (
                <div
                    style={{ top: tooltip.position.top, left: tooltip.position.left }}
                    className="absolute z-50 w-64 p-3 bg-white border border-gray-200 rounded-lg shadow-xl text-sm text-gray-700 animate-fade-in-fast"
                    onClick={(e) => e.stopPropagation()}
                >
                    {tooltip.isLoading ? (
                         <div className="flex items-center justify-center">
                            <svg className="animate-spin h-5 w-5 text-indigo-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            <span className="ml-2">Buscando info...</span>
                        </div>
                    ) : (
                        <p style={{ whiteSpace: 'pre-wrap' }}>{tooltip.content}</p>
                    )}
                </div>
            )}
            
            {modalState.isOpen && (
                 <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-40 p-4 animate-fade-in-fast" onClick={handleModalClose}>
                    <div className="bg-white rounded-lg shadow-2xl p-6 w-full max-w-lg relative" onClick={(e) => e.stopPropagation()}>
                        <button onClick={handleModalClose} className="absolute top-3 right-3 text-gray-400 hover:text-gray-600">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                        <h2 className="text-xl font-bold text-indigo-700 mb-2">Pregúntale a la IA sobre</h2>
                        <p className="text-lg text-gray-800 mb-4 font-semibold">{modalState.medication?.name}</p>

                        <form onSubmit={handleQuestionSubmit}>
                            <textarea
                                value={modalState.question}
                                onChange={(e) => setModalState(prev => ({...prev, question: e.target.value}))}
                                placeholder="Escribe tu pregunta aquí..."
                                className="w-full h-24 p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                                required
                            />
                            <button type="submit" disabled={modalState.isLoading} className="mt-4 w-full bg-indigo-600 text-white font-semibold py-2 px-4 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:bg-indigo-300 disabled:cursor-not-allowed transition-colors">
                                {modalState.isLoading ? 'Pensando...' : 'Enviar Pregunta'}
                            </button>
                        </form>

                        {modalState.isLoading && (
                            <div className="mt-4 flex justify-center items-center">
                               <svg className="animate-spin h-8 w-8 text-indigo-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                            </div>
                        )}
                        
                        {modalState.response && (
                            <div className="mt-4 p-4 bg-indigo-50 border-l-4 border-indigo-400 rounded-r-lg">
                                <p className="text-gray-800" style={{ whiteSpace: 'pre-wrap' }}>{modalState.response}</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {showInstallBanner && (
                <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 max-w-md bg-indigo-600 text-white p-4 rounded-lg shadow-lg flex items-center justify-between z-50 animate-fade-in">
                    <div className="flex items-center">
                         <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                        <div className="ml-3">
                            <p className="font-bold">Instala MedMinder</p>
                            <p className="text-sm text-indigo-200">Accede más rápido desde tu pantalla de inicio.</p>
                        </div>
                    </div>
                     <div className="flex items-center">
                        <button onClick={handleInstallClick} className="bg-white text-indigo-600 font-bold py-1 px-3 rounded-md hover:bg-indigo-100 transition-colors">
                            Instalar
                        </button>
                        <button onClick={() => setShowInstallBanner(false)} className="ml-2 p-1 text-indigo-200 hover:text-white rounded-full" aria-label="Cerrar">
                             <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                    </div>
                </div>
            )}

            <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow-lg overflow-hidden">
                <header className="p-4 sm:p-6 bg-indigo-600 text-white">
                    <div className="flex flex-col sm:flex-row items-center justify-between">
                        <div className="flex items-center space-x-3 mb-4 sm:mb-0">
                             <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-white" viewBox="0 0 20 20" fill="currentColor">
                               <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z" clipRule="evenodd" />
                             </svg>
                            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">MedMinder</h1>
                        </div>
                        
                        <div className="bg-indigo-700 p-1 rounded-full flex items-center space-x-1 flex-wrap justify-center">
                            <button 
                                onClick={() => setActiveTab('reminders')} 
                                className={`px-3 py-1.5 text-sm font-semibold rounded-full transition-colors duration-300 ease-in-out ${activeTab === 'reminders' ? 'bg-white text-indigo-700 shadow' : 'text-indigo-100 hover:bg-indigo-500'}`}
                            >
                                Recordatorios
                            </button>
                            <button 
                                onClick={() => setActiveTab('journal')} 
                                className={`px-3 py-1.5 text-sm font-semibold rounded-full transition-colors duration-300 ease-in-out ${activeTab === 'journal' ? 'bg-white text-indigo-700 shadow' : 'text-indigo-100 hover:bg-indigo-500'}`}
                            >
                                Mi Diario
                            </button>
                             <button 
                                onClick={() => setActiveTab('appointments')} 
                                className={`px-3 py-1.5 text-sm font-semibold rounded-full transition-colors duration-300 ease-in-out ${activeTab === 'appointments' ? 'bg-white text-indigo-700 shadow' : 'text-indigo-100 hover:bg-indigo-500'}`}
                            >
                                Mis Turnos
                            </button>
                             <button 
                                onClick={() => setActiveTab('archive')} 
                                className={`px-3 py-1.5 text-sm font-semibold rounded-full transition-colors duration-300 ease-in-out ${activeTab === 'archive' ? 'bg-white text-indigo-700 shadow' : 'text-indigo-100 hover:bg-indigo-500'}`}
                            >
                                Archivo
                            </button>
                        </div>
                    </div>
                </header>

                <main className="p-6">
                    {activeTab === 'reminders' && (
                        <div className="animate-fade-in">
                             {showPermissionBanner && permission === 'default' && (
                                <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4 mb-6 rounded-md flex justify-between items-center">
                                    <div>
                                        <p className="font-bold">¡Activa las notificaciones!</p>
                                        <p>Permítenos enviarte alertas para no olvidar tus remedios.</p>
                                    </div>
                                    <button onClick={async () => { await requestPermission(); setShowPermissionBanner(false); }} className="bg-yellow-500 text-white font-bold py-1 px-3 rounded hover:bg-yellow-600">
                                        Activar
                                    </button>
                                </div>
                            )}
                            <h2 className="text-2xl font-bold text-gray-800 mb-4">Agregar Medicamento</h2>
                             <form onSubmit={addMedication} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 items-end mb-8 p-4 bg-indigo-50 rounded-lg">
                                <div className="flex flex-col">
                                    <label htmlFor="name" className="text-sm font-medium text-gray-600 mb-1">Nombre</label>
                                    <input type="text" id="name" name="name" value={formState.name} onChange={handleFormChange} placeholder="Ej: Ibuprofeno" required className="p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
                                </div>
                                <div className="flex flex-col">
                                    <label htmlFor="dosage" className="text-sm font-medium text-gray-600 mb-1">Dosis (opcional)</label>
                                    <input type="text" id="dosage" name="dosage" value={formState.dosage} onChange={handleFormChange} placeholder="Ej: 600mg" className="p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
                                </div>
                                <div className="flex flex-col">
                                    <label htmlFor="time" className="text-sm font-medium text-gray-600 mb-1">Hora</label>
                                    <input type="time" id="time" name="time" value={formState.time} onChange={handleFormChange} required className="p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
                                </div>
                                <button type="submit" className="w-full bg-indigo-600 text-white font-semibold py-2 px-4 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors h-10">
                                    Agregar
                                </button>
                            </form>
                            
                            <h2 className="text-2xl font-bold text-gray-800 mb-4">Mis Recordatorios de Hoy</h2>
                            <div className="space-y-3">
                                {sortedMedications.length > 0 ? (
                                    sortedMedications.map(med => (
                                        <div key={med.id} className={`p-4 rounded-lg flex items-center justify-between transition-all duration-300 ${med.isTaken ? 'bg-green-100 text-gray-500' : 'bg-white shadow-sm'}`}>
                                            <div className="flex items-center">
                                                <input
                                                    type="checkbox"
                                                    id={`med-${med.id}`}
                                                    checked={med.isTaken}
                                                    onChange={() => toggleMedicationTaken(med.id)}
                                                    className="h-6 w-6 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                                />
                                                <label htmlFor={`med-${med.id}`} className={`ml-4 cursor-pointer ${med.isTaken ? 'line-through' : ''}`}>
                                                    <span className="block text-lg font-bold text-gray-800">{med.name}</span>
                                                    <span className="block text-sm text-gray-500">{med.dosage}</span>
                                                </label>
                                            </div>
                                            <div className="flex items-center space-x-2">
                                                 <span className={`text-xl font-mono px-3 py-1 rounded-md ${med.isTaken ? 'bg-green-200 text-green-800' : 'bg-purple-100 text-purple-800'}`}>{med.time}</span>
                                                <button onClick={(e) => handleInfoClick(med, e)} className="p-2 text-gray-400 hover:text-indigo-600 rounded-full hover:bg-indigo-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" aria-label="Info">
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                                                    </svg>
                                                </button>
                                                <button onClick={() => handleAskClick(med)} className="p-2 text-gray-400 hover:text-purple-600 rounded-full hover:bg-purple-100 focus:outline-none focus:ring-2 focus:ring-purple-500" aria-label="Ask AI">
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                                        <path d="M10 2a6 6 0 00-6 6v3.586l-1.707 1.707A1 1 0 003 15v1a1 1 0 001 1h12a1 1 0 001-1v-1a1 1 0 00-.293-.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
                                                    </svg>
                                                </button>
                                                <button onClick={() => deleteMedication(med.id)} className="p-2 text-gray-400 hover:text-red-600 rounded-full hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500" aria-label="Delete">
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                                </button>
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div className="text-center py-8 px-4 bg-gray-50 rounded-lg">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                                        </svg>
                                        <p className="mt-4 text-gray-500">Todavía no tienes recordatorios.</p>
                                        <p className="text-sm text-gray-400">¡Agrega tu primer medicamento para empezar!</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                     {activeTab === 'journal' && (
                        <div className="animate-fade-in">
                            <h2 className="text-2xl font-bold text-gray-800 mb-4">¿Cómo te sientes hoy?</h2>
                            <form onSubmit={addJournalEntry}>
                                <textarea
                                    value={newJournalEntry}
                                    onChange={(e) => setNewJournalEntry(e.target.value)}
                                    placeholder="Escribe aquí tus pensamientos..."
                                    className="w-full h-32 p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition mb-4"
                                    required
                                ></textarea>
                                <button type="submit" className="bg-purple-600 text-white font-semibold py-2 px-5 rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 transition-colors">
                                    Guardar Entrada
                                </button>
                            </form>
                            
                            <div className="mt-8">
                                <h3 className="text-xl font-bold text-gray-800 mb-4">Entradas Anteriores</h3>
                                <div className="space-y-4">
                                    {sortedJournalEntries.length > 0 ? (
                                        sortedJournalEntries.map(entry => (
                                            <div key={entry.id} className="p-4 bg-white rounded-lg shadow-sm border-l-4 border-purple-300">
                                                <p className="text-sm font-semibold text-purple-800 mb-2">{formatDate(entry.date)}</p>
                                                <p className="text-gray-700 whitespace-pre-wrap">{entry.content}</p>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="text-center py-8 px-4 bg-gray-50 rounded-lg">
                                             <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v11.494m-5.747-5.747h11.494" />
                                             </svg>
                                            <p className="mt-4 text-gray-500">Tu diario está vacío.</p>
                                            <p className="text-sm text-gray-400">¡Escribe tu primera entrada para comenzar!</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                    {activeTab === 'appointments' && (
                       <div className="animate-fade-in">
                            <h2 className="text-2xl font-bold text-gray-800 mb-4">Agendar Turno</h2>
                            <form onSubmit={addAppointment} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 items-end mb-8 p-4 bg-indigo-50 rounded-lg">
                                <div className="flex flex-col col-span-1 sm:col-span-2 md:col-span-3">
                                    <label htmlFor="specialty" className="text-sm font-medium text-gray-600 mb-1">Especialidad Médica</label>
                                    <input type="text" id="specialty" name="specialty" value={appointmentForm.specialty} onChange={handleAppointmentFormChange} placeholder="Ej: Pediatría" required className="p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
                                </div>
                                <div className="flex flex-col">
                                    <label htmlFor="date" className="text-sm font-medium text-gray-600 mb-1">Fecha</label>
                                    <input type="date" id="date" name="date" value={appointmentForm.date} onChange={handleAppointmentFormChange} required className="p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" min={new Date().toISOString().split('T')[0]}/>
                                </div>
                                <div className="flex flex-col">
                                    <label htmlFor="time" className="text-sm font-medium text-gray-600 mb-1">Hora</label>
                                    <input type="time" id="time" name="time" value={appointmentForm.time} onChange={handleAppointmentFormChange} required className="p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
                                </div>
                                <div className="flex flex-col col-span-1 sm:col-span-2 md:col-span-1">
                                    <label htmlFor="location" className="text-sm font-medium text-gray-600 mb-1">Lugar</label>
                                    <input type="text" id="location" name="location" value={appointmentForm.location} onChange={handleAppointmentFormChange} placeholder="Ej: Hospital Central" required className="p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
                                </div>
                                 <div className="col-span-1 sm:col-span-2 md:col-span-3">
                                    <button type="submit" className="w-full bg-indigo-600 text-white font-semibold py-2 px-4 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors h-10">
                                        Agendar Turno
                                    </button>
                                </div>
                            </form>
                            
                            <h2 className="text-2xl font-bold text-gray-800 mb-4">Mis Próximos Turnos</h2>
                             <div className="space-y-3">
                                {sortedAppointments.length > 0 ? (
                                    sortedAppointments.map(appt => (
                                        <div key={appt.id} className="p-4 rounded-lg flex items-center justify-between bg-white shadow-sm border-l-4 border-cyan-400">
                                            <div className="flex-1 overflow-hidden">
                                                <p className="text-lg font-bold text-gray-800">{appt.specialty}</p>
                                                <p className="text-sm text-gray-500 capitalize">{formatAppointmentDate(appt.date)}</p>
                                                <p className="text-sm text-gray-500 truncate">{appt.location}</p>
                                            </div>
                                            <div className="flex items-center space-x-2 ml-4">
                                                 <span className="text-xl font-mono px-3 py-1 rounded-md bg-cyan-100 text-cyan-800">{appt.time}</span>
                                                <button onClick={() => deleteAppointment(appt.id)} className="p-2 text-gray-400 hover:text-red-600 rounded-full hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500" aria-label="Delete Appointment">
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                                </button>
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div className="text-center py-8 px-4 bg-gray-50 rounded-lg">
                                       <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                       </svg>
                                        <p className="mt-4 text-gray-500">No tienes turnos agendados.</p>
                                        <p className="text-sm text-gray-400">Usa el formulario para agregar tu próxima cita.</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                    {activeTab === 'archive' && (
                        <div className="animate-fade-in">
                            <div className="flex justify-between items-center mb-4">
                               <h2 className="text-2xl font-bold text-gray-800">Archivo de Estudios</h2>
                               <label className="bg-teal-500 text-white font-semibold py-2 px-4 rounded-md hover:bg-teal-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-teal-500 transition-colors cursor-pointer">
                                   <span>Subir Archivo</span>
                                   <input type="file" multiple className="hidden" onChange={handleFileChange} accept="image/*,application/pdf" />
                               </label>
                            </div>
                           
                            <div className="space-y-3">
                                {archivedFiles.length > 0 ? (
                                    archivedFiles.map(file => (
                                        <div key={file.id} className="p-4 rounded-lg flex items-center justify-between bg-white shadow-sm">
                                            <div className="flex items-center space-x-4 overflow-hidden">
                                               <FileIcon mimeType={file.mimeType} />
                                                <a href={file.dataUrl} download={file.name} target="_blank" rel="noopener noreferrer" className="font-medium text-gray-800 hover:text-indigo-600 truncate" title={file.name}>
                                                  {file.name}
                                                </a>
                                            </div>
                                            <button onClick={() => deleteFile(file.id)} className="p-2 text-gray-400 hover:text-red-600 rounded-full hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 flex-shrink-0" aria-label="Delete File">
                                                 <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                            </button>
                                        </div>
                                    ))
                                ) : (
                                    <div className="text-center py-8 px-4 bg-gray-50 rounded-lg">
                                       <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                                       </svg>
                                        <p className="mt-4 text-gray-500">No hay archivos guardados.</p>
                                        <p className="text-sm text-gray-400">Sube tus análisis o estudios para mantenerlos organizados.</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
};

export default App;