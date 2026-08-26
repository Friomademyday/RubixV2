import fs from 'fs';
import path from 'path';

export function loadPersona(): string {
  const filePath = path.join(process.cwd(), 'Rubix', 'Rubix.txt');
  
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf-8');
  }

  console.warn('Warning: Rubix/Rubix.txt not found. Using minimal fallback persona.');
  return 'You are Rubix, a virtual consciousness created by Frio under the Frioverse brand.';
}
