/**
 * Line icons drawn with react-native-svg (Feather-style, 24×24 grid, MIT shapes).
 * Kept in-app so there is no icon font to load.
 */
import React from 'react';
import Svg, { Circle, Line, Path, Polygon, Polyline, Rect } from 'react-native-svg';

export type IconName =
  | 'bolt'
  | 'gamepad'
  | 'sliders'
  | 'unlock'
  | 'play'
  | 'more'
  | 'plus'
  | 'chevron'
  | 'cpu'
  | 'trash'
  | 'shield'
  | 'layers'
  | 'check';

export function Icon({
  name,
  size = 22,
  color = '#fff',
  strokeWidth = 2,
  fill = 'none',
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  fill?: string;
}) {
  const p = { stroke: color, strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'bolt' && <Polygon {...p} fill={fill} points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />}
      {name === 'gamepad' && (
        <>
          <Rect {...p} x={2} y={6} width={20} height={12} rx={6} />
          <Line {...p} x1={6} y1={12} x2={10} y2={12} />
          <Line {...p} x1={8} y1={10} x2={8} y2={14} />
          <Circle cx={15} cy={13} r={1.2} fill={color} />
          <Circle cx={18} cy={11} r={1.2} fill={color} />
        </>
      )}
      {name === 'sliders' && (
        <>
          <Line {...p} x1={4} y1={21} x2={4} y2={14} />
          <Line {...p} x1={4} y1={10} x2={4} y2={3} />
          <Line {...p} x1={12} y1={21} x2={12} y2={12} />
          <Line {...p} x1={12} y1={8} x2={12} y2={3} />
          <Line {...p} x1={20} y1={21} x2={20} y2={16} />
          <Line {...p} x1={20} y1={12} x2={20} y2={3} />
          <Line {...p} x1={1} y1={14} x2={7} y2={14} />
          <Line {...p} x1={9} y1={8} x2={15} y2={8} />
          <Line {...p} x1={17} y1={16} x2={23} y2={16} />
        </>
      )}
      {name === 'unlock' && (
        <>
          <Rect {...p} x={3} y={11} width={18} height={11} rx={2} />
          <Path {...p} d="M7 11V7a5 5 0 0 1 9.9-1" />
        </>
      )}
      {name === 'play' && <Polygon {...p} fill={fill} points="6 4 20 12 6 20 6 4" />}
      {name === 'more' && (
        <>
          <Circle cx={12} cy={5} r={1.6} fill={color} />
          <Circle cx={12} cy={12} r={1.6} fill={color} />
          <Circle cx={12} cy={19} r={1.6} fill={color} />
        </>
      )}
      {name === 'plus' && (
        <>
          <Line {...p} x1={12} y1={5} x2={12} y2={19} />
          <Line {...p} x1={5} y1={12} x2={19} y2={12} />
        </>
      )}
      {name === 'chevron' && <Polyline {...p} points="9 18 15 12 9 6" />}
      {name === 'cpu' && (
        <>
          <Rect {...p} x={4} y={4} width={16} height={16} rx={2} />
          <Rect {...p} x={9} y={9} width={6} height={6} />
          <Line {...p} x1={9} y1={1} x2={9} y2={4} />
          <Line {...p} x1={15} y1={1} x2={15} y2={4} />
          <Line {...p} x1={9} y1={20} x2={9} y2={23} />
          <Line {...p} x1={15} y1={20} x2={15} y2={23} />
          <Line {...p} x1={20} y1={9} x2={23} y2={9} />
          <Line {...p} x1={20} y1={14} x2={23} y2={14} />
          <Line {...p} x1={1} y1={9} x2={4} y2={9} />
          <Line {...p} x1={1} y1={14} x2={4} y2={14} />
        </>
      )}
      {name === 'trash' && (
        <>
          <Polyline {...p} points="3 6 5 6 21 6" />
          <Path {...p} d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <Path {...p} d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
        </>
      )}
      {name === 'shield' && <Path {...p} d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />}
      {name === 'layers' && (
        <>
          <Polygon {...p} points="12 2 2 7 12 12 22 7 12 2" />
          <Polyline {...p} points="2 17 12 22 22 17" />
          <Polyline {...p} points="2 12 12 17 22 12" />
        </>
      )}
      {name === 'check' && <Polyline {...p} points="20 6 9 17 4 12" />}
    </Svg>
  );
}
