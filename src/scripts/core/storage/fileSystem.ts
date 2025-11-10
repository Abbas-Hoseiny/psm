const FILE_OPTIONS = {
  description: 'JSON-Datei',
  accept: { 'application/json': ['.json'] }
};

let fileHandle: any = null;

async function writeFile(handle: any, data: any): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
}

async function readFile(handle: any): Promise<string> {
  const file = await handle.getFile();
  return file.text();
}

export function isSupported(): boolean {
  return typeof window !== 'undefined' && typeof (window as any).showSaveFilePicker === 'function';
}

export async function create(initialData: any, suggestedName: string = 'database.json'): Promise<{ data: any; context: any }> {
  if (!isSupported()) {
    throw new Error('File System Access API not available');
  }
  fileHandle = await (window as any).showSaveFilePicker({
    suggestedName,
    types: [FILE_OPTIONS]
  });
  await writeFile(fileHandle, initialData);
  return { data: initialData, context: { fileHandle } };
}

export async function open(): Promise<{ data: any; context: any }> {
  if (!isSupported()) {
    throw new Error('File System Access API not available');
  }
  const [handle] = await (window as any).showOpenFilePicker({ types: [FILE_OPTIONS] });
  fileHandle = handle;
  const text = await readFile(fileHandle);
  const data = JSON.parse(text);
  return { data, context: { fileHandle } };
}

export async function save(data: any): Promise<{ context: any }> {
  if (!fileHandle) {
    throw new Error('Kein Dateihandle vorhanden');
  }
  await writeFile(fileHandle, data);
  return { context: { fileHandle } };
}

export function getContext(): any {
  return { fileHandle };
}

export function reset(): void {
  fileHandle = null;
}
