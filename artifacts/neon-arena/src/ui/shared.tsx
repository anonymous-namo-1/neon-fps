import React, { ReactNode } from 'react';

export function UiPanel({ children, className = '', slant = true, 'data-testid': testId }: { children: ReactNode; className?: string; slant?: boolean; 'data-testid'?: string }) {
  return (
    <div data-testid={testId} className={`relative bg-background/90 border border-primary/30 backdrop-blur-sm ${slant ? 'clip-path-slant' : ''} ${className}`}>
      {/* Decorative corner accents */}
      <div className="absolute top-0 left-0 w-2 h-2 border-t-2 border-l-2 border-primary pointer-events-none" />
      <div className="absolute top-0 right-0 w-2 h-2 border-t-2 border-r-2 border-primary pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-2 h-2 border-b-2 border-l-2 border-primary pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-2 h-2 border-b-2 border-r-2 border-primary pointer-events-none" />
      {children}
    </div>
  );
}

export function UiButton({ 
  children, 
  onClick, 
  className = '', 
  variant = 'primary',
  disabled = false,
  testId,
}: { 
  children: ReactNode; 
  onClick?: () => void; 
  className?: string; 
  variant?: 'primary' | 'destructive' | 'outline';
  disabled?: boolean;
  testId?: string;
}) {
  const baseStyle = "group relative px-6 py-2 uppercase font-bold tracking-widest text-lg transition-all duration-200 clip-path-slant focus:outline-none";
  
  const variants = {
    primary: "bg-primary/10 text-primary border border-primary hover:bg-primary hover:text-primary-foreground box-shadow-neon",
    destructive: "bg-destructive/10 text-destructive border border-destructive hover:bg-destructive hover:text-destructive-foreground",
    outline: "bg-transparent text-white border border-white/20 hover:bg-white/10 hover:border-white",
  };

  return (
    <button 
      onClick={onClick} 
      className={`${baseStyle} ${variants[variant]} ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
      disabled={disabled}
      data-testid={testId}
    >
      <span className="relative z-10">{children}</span>
      <div className="absolute inset-0 bg-scanline opacity-20 group-hover:opacity-50 pointer-events-none" />
    </button>
  );
}

export function GlitchHeading({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <h1 className={`text-6xl md:text-8xl font-bold uppercase tracking-[0.2em] text-white text-shadow-neon relative ${className}`}>
      {children}
    </h1>
  );
}

export function StatRow({ label, value, highlight = false }: { label: string, value: string | number, highlight?: boolean }) {
  return (
    <div className="flex justify-between items-center py-1 border-b border-white/10 last:border-0">
      <span className="text-muted-foreground uppercase text-sm font-mono tracking-wider">{label}</span>
      <span className={`font-mono font-bold text-lg ${highlight ? 'text-primary' : 'text-white'}`}>{value}</span>
    </div>
  );
}
