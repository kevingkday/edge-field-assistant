export interface SamplePhotoResult {
  blob: Blob;
  suggestedTranscript: string;
}

function canvasToJpegBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to generate sample photo'));
        }
      },
      'image/jpeg',
      0.9
    );
  });
}

export async function createSamplePhotoForSchema(
  schemaId: string
): Promise<SamplePhotoResult> {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable');
  }

  if (schemaId === 'twinflow-lead-intake') {
    // Business card sample
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 768, 512);

    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.roundRect(74, 86, 620, 340, 18);
    ctx.fill();

    ctx.fillStyle = '#0ea5e9';
    ctx.fillRect(74, 86, 16, 340);

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 34px system-ui, sans-serif';
    ctx.fillText('SARAH CHEN', 124, 160);

    ctx.fillStyle = '#475569';
    ctx.font = '600 20px system-ui, sans-serif';
    ctx.fillText('VP of Field Operations', 124, 195);

    ctx.fillStyle = '#0284c7';
    ctx.font = 'bold 24px system-ui, sans-serif';
    ctx.fillText('Pacific Timber & Supply Co.', 124, 245);

    ctx.fillStyle = '#334155';
    ctx.font = '18px ui-monospace, monospace';
    ctx.fillText('Email: sarah.chen@pacifictimber.ca', 124, 305);
    ctx.fillText('Phone: (604) 555-0148', 124, 338);
    ctx.fillText('Office: North Vancouver, BC', 124, 371);

    const blob = await canvasToJpegBlob(canvas);
    return {
      blob,
      suggestedTranscript:
        'Met Sarah Chen at Pacific Timber. Looking to equip 15 field inspectors with offline capture.',
    };
  }

  if (schemaId === 'general-voice-notes') {
    // Whiteboard / memo sample
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(0, 0, 768, 512);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(36, 36, 696, 440);
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 4;
    ctx.strokeRect(36, 36, 696, 440);

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 28px system-ui, sans-serif';
    ctx.fillText('SITE WALKTHROUGH MEMO — NORTH WING', 68, 96);

    ctx.fillStyle = '#1e293b';
    ctx.font = '22px system-ui, sans-serif';
    ctx.fillText('• Scupper drain #3 partially blocked with debris', 68, 165);
    ctx.fillText('• Electrical room clear, 200A panel tagged OK', 68, 215);
    ctx.fillText('• Action: Mike Torres (Apex Roofing) to clear drain', 68, 265);
    ctx.fillText('• Follow-up inspection scheduled: Friday Nov 28', 68, 315);

    ctx.fillStyle = '#0ea5e9';
    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.fillText('PRIORITY: MEDIUM  |  OWNER: MIKE TORRES', 68, 405);

    const blob = await canvasToJpegBlob(canvas);
    return {
      blob,
      suggestedTranscript:
        'Walked North Wing roof with Mike Torres from Apex Roofing. Scupper drain 3 is blocked and needs clearing before next rain. Follow up Friday Nov 28.',
    };
  }

  // Default: Property / Facility Inspection (200A Siemens Main Electrical Panel)
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(0, 0, 768, 512);

  // Outer grey metal panel box
  ctx.fillStyle = '#64748b';
  ctx.fillRect(144, 36, 480, 440);
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 6;
  ctx.strokeRect(144, 36, 480, 440);

  // Inner breaker door
  ctx.fillStyle = '#475569';
  ctx.fillRect(184, 76, 400, 360);

  // Manufacturer plate
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(214, 96, 340, 82);
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 26px system-ui, sans-serif';
  ctx.fillText('SIEMENS  200A MAIN', 238, 134);
  ctx.font = '16px ui-monospace, monospace';
  ctx.fillText('120/240V AC • 1-PHASE • COPPER BUS', 230, 162);

  // Breaker rows
  for (let row = 0; row < 5; row++) {
    const y = 204 + row * 40;
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(224, y, 130, 28);
    ctx.fillRect(414, y, 130, 28);
    ctx.fillStyle = row === 0 ? '#ef4444' : '#cbd5e1';
    ctx.fillRect(320, y + 6, 24, 16);
    ctx.fillRect(424, y + 6, 24, 16);
  }

  ctx.fillStyle = '#34d399';
  ctx.font = 'bold 16px ui-monospace, monospace';
  ctx.fillText('36" CLEARANCE VERIFIED • NO CORROSION', 205, 456);

  const blob = await canvasToJpegBlob(canvas);
  return {
    blob,
    suggestedTranscript:
      '200A Siemens main electrical panel, 120/240V, clean 36 inch clearance, no corrosion.',
  };
}
