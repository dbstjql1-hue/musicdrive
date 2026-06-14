import { useRef, useState } from 'react';

/**
 * HoverButton renders a button with a mouse-tracking radial gradient glow effect.
 * It is built using vanilla inline CSS to support non-Tailwind projects.
 */
const HoverButton = ({ 
  children, 
  onClick, 
  className = '', 
  disabled = false,
  glowColor = '#00ffc3',
  backgroundColor = '#111827',
  textColor = '#ffffff',
  hoverTextColor = '#67e8f9',
  style = {}
}) => {
  const buttonRef = useRef(null);
  const [glowPosition, setGlowPosition] = useState({ x: 50, y: 50 });
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseMove = (e) => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setGlowPosition({ x, y });
    }
  };

  const handleMouseEnter = () => {
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
  };

  return (
    <button
      ref={buttonRef}
      onClick={onClick}
      disabled={disabled}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={className}
      style={{
        backgroundColor: backgroundColor,
        color: isHovered ? hoverTextColor : textColor,
        position: 'relative',
        display: 'inline-block',
        padding: '14px 44px',
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        overflow: 'hidden',
        transition: 'color 0.3s ease, background-color 0.3s ease, transform 0.2s ease',
        fontSize: '16px',
        fontWeight: '600',
        borderRadius: '30px',
        zIndex: 10,
        fontFamily: "'Outfit', sans-serif",
        letterSpacing: '2px',
        boxShadow: isHovered ? `0 0 25px ${glowColor}77` : `0 0 15px ${glowColor}33`,
        opacity: disabled ? 0.5 : 1,
        outline: 'none',
        ...style
      }}
    >
      {/* Glow effect div */}
      <div
        style={{
          position: 'absolute',
          width: '200px',
          height: '200px',
          borderRadius: '50%',
          opacity: 0.5,
          pointerEvents: 'none',
          transition: 'transform 0.4s ease-out',
          transform: `translate(-50%, -50%) ${isHovered ? 'scale(1.2)' : 'scale(0)'}`,
          left: `${glowPosition.x}px`,
          top: `${glowPosition.y}px`,
          background: `radial-gradient(circle, ${glowColor} 10%, transparent 70%)`,
          zIndex: 0,
        }}
      />
      
      {/* Button content */}
      <span style={{ position: 'relative', zIndex: 10, pointerEvents: 'none' }}>{children}</span>
    </button>
  );
};

export { HoverButton };
