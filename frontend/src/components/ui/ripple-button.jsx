import { useState, useMemo } from 'react';

/**
 * RippleButton renders a button with hover-grid interactive ripple effects.
 * Translated from Tailwind classes to standard inline CSS to support non-Tailwind environments.
 */
const hexToRgba = (hex, alpha) => {
  let hexValue = hex.startsWith('#') ? hex.slice(1) : hex;
  if (hexValue.length === 3) {
    hexValue = hexValue.split('').map(char => char + char).join('');
  }
  const r = parseInt(hexValue.slice(0, 2), 16);
  const g = parseInt(hexValue.slice(2, 4), 16);
  const b = parseInt(hexValue.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const GRID_HOVER_NUM_COLS = 36;
const GRID_HOVER_NUM_ROWS = 12;
const GRID_HOVER_TOTAL_CELLS = GRID_HOVER_NUM_COLS * GRID_HOVER_NUM_ROWS;
const GRID_HOVER_RIPPLE_EFFECT_SIZE = "18.973665961em";

const JS_RIPPLE_KEYFRAMES = `
  @keyframes js-ripple-animation {
    0% { transform: scale(0); opacity: 1; }
    100% { transform: scale(1); opacity: 0; }
  }
  .animate-js-ripple-effect {
    animation: js-ripple-animation var(--ripple-duration) ease-out forwards;
  }
`;

const RippleButton = ({
  children,
  onClick,
  className = '',
  disabled = false,
  variant = 'default',
  rippleColor,
  rippleDuration = 600,
  hoverBaseColor = '#6996e2',
  hoverRippleColor,
  hoverBorderEffectColor = '#6996e277',
  hoverBorderEffectThickness = '0.3em',
}) => {
  const [jsRipples, setJsRipples] = useState([]);

  const determinedJsRippleColor = useMemo(() => {
    if (rippleColor) {
      return rippleColor;
    }
    return 'rgba(0, 0, 0, 0.1)';
  }, [rippleColor]);

  const dynamicGridHoverStyles = useMemo(() => {
    let nthChildHoverRules = '';
    const cellDim = 0.25;
    const initialTopOffset = 0.125;
    const initialLeftOffset = 0.1875;
    const hoverEffectDuration = '0.9s';

    for (let r = 0; r < GRID_HOVER_NUM_ROWS; r++) {
      for (let c = 0; c < GRID_HOVER_NUM_COLS; c++) {
        const childIndex = r * GRID_HOVER_NUM_COLS + c + 1;
        const topPos = initialTopOffset + r * cellDim;
        const leftPos = initialLeftOffset + c * cellDim;

        if (variant === 'hover') {
          nthChildHoverRules += `
            .hover-variant-grid-cell:nth-child(${childIndex}):hover ~ .hover-variant-visual-ripple {
              top: ${topPos}em; left: ${leftPos}em;
              transition: width ${hoverEffectDuration} ease, height ${hoverEffectDuration} ease, top 0s linear, left 0s linear;
            }`;
        } else if (variant === 'hoverborder') {
          nthChildHoverRules += `
            .hoverborder-variant-grid-cell:nth-child(${childIndex}):hover ~ .hoverborder-variant-visual-ripple {
              top: ${topPos}em; left: ${leftPos}em;
              transition: width ${hoverEffectDuration} ease-out, height ${hoverEffectDuration} ease-out, top 0s linear, left 0s linear;
            }`;
        }
      }
    }

    if (variant === 'hover') {
      const actualHoverRippleColor = hoverRippleColor
        ? hoverRippleColor
        : hexToRgba(hoverBaseColor, 0.466);
      return `
        .hover-variant-visual-ripple {
          background-color: ${actualHoverRippleColor};
          transition: width ${hoverEffectDuration} ease, height ${hoverEffectDuration} ease, top 99999s linear, left 99999s linear;
        }
        .hover-variant-grid-cell:hover ~ .hover-variant-visual-ripple {
          width: ${GRID_HOVER_RIPPLE_EFFECT_SIZE}; height: ${GRID_HOVER_RIPPLE_EFFECT_SIZE};
        }
        ${nthChildHoverRules}
      `;
    } else if (variant === 'hoverborder') {
      return `
        .hoverborder-variant-ripple-container {
          padding: ${hoverBorderEffectThickness};
          mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          mask-composite: exclude;
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;
        }
        .hoverborder-variant-visual-ripple {
          background-color: ${hoverBorderEffectColor};
          transition: width ${hoverEffectDuration} ease-out, height ${hoverEffectDuration} ease-out, top 99999s linear, left 9999s linear;
        }
        .hoverborder-variant-grid-cell:hover ~ .hoverborder-variant-visual-ripple {
          width: ${GRID_HOVER_RIPPLE_EFFECT_SIZE}; height: ${GRID_HOVER_RIPPLE_EFFECT_SIZE};
        }
        ${nthChildHoverRules}
      `;
    }
    return '';
  }, [variant, hoverBaseColor, hoverRippleColor, hoverBorderEffectColor, hoverBorderEffectThickness]);

  const createJsRipple = (event) => {
    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2;
    const x = event.clientX - rect.left - size / 2;
    const y = event.clientY - rect.top - size / 2;
    const newRipple = { key: Date.now(), x, y, size, color: determinedJsRippleColor };
    setJsRipples(prev => [...prev, newRipple]);
    setTimeout(() => {
      setJsRipples(currentRipples => currentRipples.filter(r => r.key !== newRipple.key));
    }, rippleDuration);
  };

  const handleButtonClick = (event) => {
    if (!disabled) {
      createJsRipple(event);
      if (onClick) onClick(event);
    }
  };

  const jsRippleElements = (
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none', zIndex: 5 }}>
      {jsRipples.map(ripple => (
        <span
          key={ripple.key}
          className="animate-js-ripple-effect"
          style={{
            position: 'absolute',
            borderRadius: '50%',
            left: ripple.x, top: ripple.y, width: ripple.size, height: ripple.size,
            backgroundColor: ripple.color,
            '--ripple-duration': `${rippleDuration}ms`,
          }}
        />
      ))}
    </div>
  );

  const gridStyle = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    display: 'grid',
    overflow: 'hidden',
    pointerEvents: 'none',
    zIndex: 0
  };

  if (variant === 'hover') {
    return (
      <>
        <style dangerouslySetInnerHTML={{ __html: JS_RIPPLE_KEYFRAMES }} />
        <style dangerouslySetInnerHTML={{ __html: dynamicGridHoverStyles }} />
        <button
          className={className}
          onClick={handleButtonClick}
          disabled={disabled}
          style={{
            position: 'relative',
            borderRadius: '8px',
            fontSize: '18px',
            padding: '8px 16px',
            border: 'none',
            backgroundColor: 'transparent',
            cursor: disabled ? 'not-allowed' : 'pointer',
            overflow: 'hidden',
            opacity: disabled ? 0.5 : 1,
          }}
        >
          <span style={{ position: 'relative', zIndex: 10, pointerEvents: 'none' }}>{children}</span>
          {jsRippleElements}
          <div
            className="hover-variant-grid-container"
            style={{ ...gridStyle, gridTemplateColumns: `repeat(${GRID_HOVER_NUM_COLS}, 0.25em)` }}
          >
            {Array.from({ length: GRID_HOVER_TOTAL_CELLS }, (_, index) => (
              <span
                key={index}
                className="hover-variant-grid-cell"
                style={{
                  position: 'relative',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  pointerEvents: 'auto'
                }}
              />
            ))}
            <div
              className="hover-variant-visual-ripple"
              style={{
                pointerEvents: 'none',
                position: 'absolute',
                width: 0,
                height: 0,
                borderRadius: '50%',
                transform: 'translate(-50%, -50%)',
                top: 0,
                left: 0,
                zIndex: -1
              }}
            />
          </div>
        </button>
      </>
    );
  }

  if (variant === 'hoverborder') {
    return (
      <>
        <style dangerouslySetInnerHTML={{ __html: JS_RIPPLE_KEYFRAMES }} />
        <style dangerouslySetInnerHTML={{ __html: dynamicGridHoverStyles }} />
        <button
          className={className}
          onClick={handleButtonClick}
          disabled={disabled}
          style={{
            position: 'relative',
            borderRadius: '8px',
            overflow: 'hidden',
            fontSize: '18px',
            padding: '8px 16px',
            border: 'none',
            backgroundColor: 'transparent',
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.5 : 1,
          }}
        >
          <span style={{ position: 'relative', zIndex: 10, pointerEvents: 'none' }}>{children}</span>
          {jsRippleElements}
          <div
            className="hoverborder-variant-ripple-container"
            style={{
              ...gridStyle,
              borderRadius: '0.8em',
              gridTemplateColumns: `repeat(${GRID_HOVER_NUM_COLS}, 0.25em)`
            }}
          >
            {Array.from({ length: GRID_HOVER_TOTAL_CELLS }, (_, index) => (
              <span
                key={index}
                className="hoverborder-variant-grid-cell"
                style={{
                  position: 'relative',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  pointerEvents: 'auto'
                }}
              />
            ))}
            <div
              className="hoverborder-variant-visual-ripple"
              style={{
                pointerEvents: 'none',
                position: 'absolute',
                width: 0,
                height: 0,
                borderRadius: '50%',
                transform: 'translate(-50%, -50%)',
                top: 0,
                left: 0,
                zIndex: -1
              }}
            />
          </div>
        </button>
      </>
    );
  }

  if (variant === 'ghost') {
    return (
      <>
        <style dangerouslySetInnerHTML={{ __html: JS_RIPPLE_KEYFRAMES }} />
        <button
          className={className}
          onClick={handleButtonClick}
          disabled={disabled}
          style={{
            position: 'relative',
            border: 'none',
            backgroundColor: 'transparent',
            cursor: disabled ? 'not-allowed' : 'pointer',
            overflow: 'hidden',
            padding: '8px 16px',
            borderRadius: '8px',
            fontSize: '18px',
            opacity: disabled ? 0.5 : 1,
          }}
        >
          <span style={{ position: 'relative', zIndex: 10, pointerEvents: 'none' }}>{children}</span>
          {jsRippleElements}
        </button>
      </>
    );
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: JS_RIPPLE_KEYFRAMES }} />
      <button
        className={className}
        onClick={handleButtonClick}
        disabled={disabled}
        style={{
          position: 'relative',
          border: 'none',
          overflow: 'hidden',
          cursor: disabled ? 'not-allowed' : 'pointer',
          padding: '8px 16px',
          borderRadius: '8px',
          fontSize: '18px',
          opacity: disabled ? 0.5 : 1,
          backgroundColor: '#3b82f6',
          color: '#ffffff',
          transition: 'all 0.2s',
        }}
      >
        <span style={{ position: 'relative', zIndex: 1, pointerEvents: 'none' }}>{children}</span>
        {jsRippleElements}
      </button>
    </>
  );
};

export { RippleButton };
