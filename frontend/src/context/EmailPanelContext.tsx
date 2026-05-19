import React, { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

export interface EmailPanelProduct {
  title: string;
  price: number;
  weight: number;
  moq: number;
  airDelivery: string;
  seaDelivery: string;
  supplier: string;
  category: string;
  imageUrl?: string;
  trendingScore?: number;
}

export interface EmailPanelConfig {
  recipients?: string[];
  product?: EmailPanelProduct;
}

interface EmailPanelContextType {
  isOpen: boolean;
  config: EmailPanelConfig;
  openEmailPanel: (config?: EmailPanelConfig) => void;
  closeEmailPanel: () => void;
}

const EmailPanelContext = createContext<EmailPanelContextType>({
  isOpen: false,
  config: {},
  openEmailPanel: () => {},
  closeEmailPanel: () => {},
});

export function useEmailPanel() {
  return useContext(EmailPanelContext);
}

interface Props {
  children: ReactNode;
}

export function EmailPanelProvider({ children }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [config, setConfig] = useState<EmailPanelConfig>({});

  const openEmailPanel = useCallback((cfg?: EmailPanelConfig) => {
    setConfig(cfg || {});
    setIsOpen(true);
  }, []);

  const closeEmailPanel = useCallback(() => {
    setIsOpen(false);
    setConfig({});
  }, []);

  return (
    <EmailPanelContext.Provider value={{ isOpen, config, openEmailPanel, closeEmailPanel }}>
      {children}
    </EmailPanelContext.Provider>
  );
}
