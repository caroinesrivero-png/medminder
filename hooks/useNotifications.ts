import { useState, useEffect } from 'react';

export function useNotifications() {
  const [permission, setPermission] = useState<NotificationPermission>('default');

  useEffect(() => {
    // Check for permission support on component mount
    if ('Notification' in window) {
      setPermission(Notification.permission);
    }
  }, []);

  const requestPermission = async () => {
    if (!('Notification' in window)) {
      console.error('Este navegador no soporta notificaciones de escritorio.');
      return;
    }
    try {
        const status = await Notification.requestPermission();
        setPermission(status);
    } catch (error) {
        console.error("Error requesting notification permission:", error);
    }
  };

  const showNotification = (title: string, options?: NotificationOptions) => {
    if (permission === 'granted') {
      new Notification(title, options);
    }
  };

  return { permission, requestPermission, showNotification };
}
