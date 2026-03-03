import { useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, Users, FileSpreadsheet, Trash2, AlertTriangle } from "lucide-react";
import { Contact } from "@/types/campaign";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { motion } from "framer-motion";
import { toast } from "@/hooks/use-toast";

interface Step1Props {
  contacts: Contact[];
  setContacts: (contacts: Contact[]) => void;
  manualInput: string;
  setManualInput: (value: string) => void;
  onNext: () => void;
}

type CsvRow = Record<string, string | number | undefined | null>;
type ParseResult = { contacts: Contact[]; undetected: string[] };

const sanitizePhone = (value: string) => String(value || "").replace(/[^\d]/g, "");
const isValidPhone = (digits: string) => digits.length >= 8 && digits.length <= 15;
const getRowPhone = (row: CsvRow) =>
  String(row.phone || row.telefono || row.numero || row.celular || Object.values(row)[0] || "").trim();

const Step1Contacts = ({ contacts, setContacts, manualInput, setManualInput, onNext }: Step1Props) => {
  const [undetectedEntries, setUndetectedEntries] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const mergeUniqueContacts = (items: Contact[]) => {
    const byPhone = new Map<string, Contact>();
    items.forEach((entry) => {
      const phone = sanitizePhone(entry.phone);
      if (!isValidPhone(phone)) return;
      const existing = byPhone.get(phone);
      if (!existing) {
        byPhone.set(phone, {
          ...entry,
          id: entry.id || crypto.randomUUID(),
          phone,
        });
        return;
      }
      byPhone.set(phone, {
        ...existing,
        ...entry,
        id: existing.id,
        phone,
      });
    });
    return Array.from(byPhone.values());
  };

  const parseRows = (rows: CsvRow[]): ParseResult => {
    const parsed: Contact[] = [];
    const undetected: string[] = [];

    rows.forEach((row, index) => {
      const rawPhone = getRowPhone(row);
      const phone = sanitizePhone(rawPhone);

      if (!isValidPhone(phone)) {
        undetected.push(`Fila ${index + 2}: ${rawPhone || "(vacío)"}`);
        return;
      }

      parsed.push({
        id: crypto.randomUUID(),
        phone,
        name: String(row.name || row.nombre || "").trim(),
        business: String(row.business || row.negocio || "").trim(),
        location: String(row.location || row.ubicacion || "").trim(),
      });
    });

    return { contacts: parsed, undetected };
  };

  const parseCSV = (text: string): ParseResult => {
    const result = Papa.parse(text, { header: true, skipEmptyLines: true });
    return parseRows(result.data as CsvRow[]);
  };

  const parseExcel = async (file: File): Promise<ParseResult> => {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: "array" });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<CsvRow>(firstSheet, { defval: "" });
    return parseRows(rows);
  };

  const parseManualInput = (input: string): ParseResult => {
    const raw = input.trim();
    if (!raw) {
      return { contacts: [], undetected: [] };
    }

    const hasStrongDelimiter = /[\n,;|]/.test(raw);
    let chunks = hasStrongDelimiter ? raw.split(/[\n,;|]+/) : [raw];

    if (!hasStrongDelimiter && /\s+/.test(raw)) {
      const parts = raw.split(/\s+/).filter(Boolean);
      const longParts = parts.filter((part) => isValidPhone(sanitizePhone(part)));
      if (longParts.length >= 2) {
        chunks = longParts;
      }
    }

    const contactsDetected: Contact[] = [];
    const undetected: string[] = [];

    chunks
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .forEach((chunk) => {
        const phone = sanitizePhone(chunk);
        if (!isValidPhone(phone)) {
          undetected.push(chunk);
          return;
        }
        contactsDetected.push({
          id: crypto.randomUUID(),
          phone,
        });
      });

    return { contacts: contactsDetected, undetected };
  };

  const notifyDetection = (result: ParseResult, sourceLabel: string) => {
    setUndetectedEntries(result.undetected.slice(0, 50));

    if (result.contacts.length > 0) {
      toast({
        title: `${sourceLabel}: ${result.contacts.length} contactos detectados`,
        description:
          result.undetected.length > 0
            ? `${result.undetected.length} entradas no detectadas`
            : "Todos los números fueron detectados",
      });
      return;
    }

    toast({
      title: `${sourceLabel}: no se detectaron contactos válidos`,
      description: "Verifica formato y código de país (ej. 51999999999)",
      variant: "destructive",
    });
  };

  const hydrateFromParsedContacts = (parsed: ParseResult, sourceLabel: string) => {
    const uniqueContacts = mergeUniqueContacts(parsed.contacts);
    setContacts(uniqueContacts);
    setManualInput(uniqueContacts.map((c) => c.phone).join("\n"));
    notifyDetection(
      {
        contacts: uniqueContacts,
        undetected: parsed.undetected,
      },
      sourceLabel
    );
  };

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileName = file.name.toLowerCase();
    try {
      if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
        const parsed = await parseExcel(file);
        hydrateFromParsedContacts(parsed, "Excel");
      } else {
        const text = await file.text();
        const parsed = parseCSV(text);
        hydrateFromParsedContacts(parsed, "CSV");
      }
    } catch (_error) {
      toast({
        title: "No se pudo leer el archivo",
        description: "Revisa que el formato sea válido (CSV/XLSX)",
        variant: "destructive",
      });
    } finally {
      e.target.value = "";
    }
  };

  const handleManualParse = () => {
    const parsed = parseManualInput(manualInput);
    const uniqueContacts = mergeUniqueContacts([...contacts, ...parsed.contacts]);
    setContacts(uniqueContacts);
    notifyDetection(
      {
        contacts: uniqueContacts,
        undetected: parsed.undetected,
      },
      "Pegado manual"
    );
    setManualInput("");
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div className="grid grid-cols-1 gap-6">
        <Card className="border-white/80">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Users className="w-5 h-5 text-primary" />
                  Pegar números
                </CardTitle>
                <CardDescription>
                  Separadores soportados: salto de línea, coma, punto y coma o espacios
                </CardDescription>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-primary hover:text-primary"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <FileSpreadsheet className="w-4 h-4 mr-1" />
                  Subir archivo CSV
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 border-white/20"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="w-4 h-4" />
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt,.xlsx,.xls"
                  className="hidden"
                  onChange={handleFileInput}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              placeholder="+52 555 123 4567&#10;+52 555 987 6543&#10;+52 555 111 2233"
              rows={6}
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              className="resize-none bg-muted/50"
            />
            <Button onClick={handleManualParse} disabled={!manualInput.trim()} className="w-full">
              Agregar contactos
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Counter + Preview */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg">Contactos detectados</CardTitle>
            <CardDescription>
              <span className="text-2xl font-bold text-primary">{contacts.length}</span> contactos
              listos
            </CardDescription>
          </div>
          {contacts.length > 0 && (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setContacts([]);
                  setUndetectedEntries([]);
                }}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="w-4 h-4 mr-1" /> Limpiar
              </Button>
            </div>
          )}
        </CardHeader>
        {contacts.length > 0 && (
          <CardContent>
            <div className="max-h-48 overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Teléfono</TableHead>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Negocio</TableHead>
                    <TableHead>Ubicación</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contacts.slice(0, 50).map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono text-sm">{c.phone}</TableCell>
                      <TableCell>{c.name || "—"}</TableCell>
                      <TableCell>{c.business || "—"}</TableCell>
                      <TableCell>{c.location || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {contacts.length > 50 && (
              <p className="text-xs text-muted-foreground mt-2 text-center">
                Mostrando 50 de {contacts.length} contactos
              </p>
            )}
          </CardContent>
        )}
      </Card>

      {undetectedEntries.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-amber-300">
              <AlertTriangle className="w-4 h-4" />
              Entradas no detectadas ({undetectedEntries.length})
            </CardTitle>
            <CardDescription>
              Revisa estos valores; no cumplen formato de teléfono válido (8-15 dígitos).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-32 overflow-auto rounded-md border border-amber-500/20 bg-background/50 p-2">
              {undetectedEntries.map((entry, index) => (
                <p key={`${entry}-${index}`} className="text-xs font-mono text-amber-200/90 py-0.5">
                  {entry}
                </p>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end">
        <Button onClick={onNext} disabled={contacts.length === 0} size="lg">
          Continuar →
        </Button>
      </div>
    </motion.div>
  );
};

export default Step1Contacts;
