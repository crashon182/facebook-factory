// Páginas legales públicas que Meta exige para una app: política de privacidad, condiciones del servicio e
// instrucciones de eliminación de datos. Se generan por cada página (por `slug`) a partir de plantillas.
// Sin dependencias de servidor: se usa tanto en las rutas públicas como en la UI y en los tests.

export const LEGAL_DOCS = ["privacidad", "terminos", "eliminacion-de-datos"] as const;
export type LegalDoc = (typeof LEGAL_DOCS)[number];

export const LEGAL_LABELS: Record<LegalDoc, string> = {
  privacidad: "Política de privacidad",
  terminos: "Condiciones del servicio",
  "eliminacion-de-datos": "Eliminación de datos de usuario",
};

export function isLegalDoc(v: string): v is LegalDoc {
  return (LEGAL_DOCS as readonly string[]).includes(v);
}

export function legalPath(slug: string, doc: LegalDoc): string {
  return `/legal/${slug}/${doc}`;
}

export type LegalSection = { heading: string; paragraphs?: string[]; list?: string[] };
export type LegalContent = { title: string; intro: string; sections: LegalSection[] };
export type LegalContext = { pageName: string; contactEmail: string; updated: string };

export function buildLegalContent(doc: LegalDoc, { pageName, contactEmail, updated }: LegalContext): LegalContent {
  const contact: LegalSection = {
    heading: "Contacto",
    paragraphs: [`Para cualquier consulta sobre este documento escribí a ${contactEmail}.`],
  };
  const upd = `Última actualización: ${updated}.`;

  if (doc === "privacidad") {
    return {
      title: `Política de privacidad de ${pageName}`,
      intro: `${upd} Esta política explica qué información trata ${pageName} cuando administra su Página de Facebook con la plataforma Facebook Factory.`,
      sections: [
        {
          heading: "Qué información tratamos",
          paragraphs: ["Cuando el administrador conecta su Página, Meta nos entrega, según los permisos que autoriza:"],
          list: [
            "Identificador y nombre de la Página de Facebook y de la cuenta que la administra.",
            "Un token de acceso de la Página, que guardamos cifrado y solo se usa para publicar y leer datos de esa Página.",
            "Las publicaciones que creamos desde la plataforma (texto, imágenes y videos) y su estado de publicación.",
            "Métricas de rendimiento de la Página y de sus publicaciones (por ejemplo alcance e interacciones), en forma agregada.",
          ],
        },
        {
          heading: "Para qué la usamos",
          list: [
            "Programar y publicar contenido en la Página de Facebook.",
            "Mostrar al administrador el rendimiento de sus publicaciones.",
            "Mantener la seguridad y el funcionamiento del servicio.",
          ],
        },
        {
          heading: "Lo que no hacemos",
          paragraphs: [
            "No vendemos ni alquilamos información. No usamos los datos obtenidos de Meta para publicidad ni los compartimos con terceros, salvo proveedores que procesan el servicio por nuestra cuenta (por ejemplo, alojamiento) o cuando una ley lo exija.",
          ],
        },
        {
          heading: "Conservación y seguridad",
          paragraphs: [
            "Conservamos la información mientras la Página esté conectada. Los tokens se almacenan cifrados y el acceso a la plataforma está restringido a administradores autenticados. Al desconectar la Página o pedir la eliminación (ver las instrucciones de eliminación de datos) borramos el token y los datos asociados.",
          ],
        },
        {
          heading: "Tus derechos",
          paragraphs: ["Podés pedir acceso, corrección o eliminación de tus datos en cualquier momento escribiendo al contacto indicado abajo."],
        },
        contact,
      ],
    };
  }

  if (doc === "terminos") {
    return {
      title: `Condiciones del servicio de ${pageName}`,
      intro: `${upd} Estas condiciones regulan el uso de la plataforma Facebook Factory por parte de ${pageName} para administrar su Página de Facebook.`,
      sections: [
        {
          heading: "Uso del servicio",
          paragraphs: [
            "El servicio permite programar, generar y publicar contenido en Páginas de Facebook que el usuario administra. Solo pueden conectarse Páginas sobre las que el usuario tenga permisos de administración.",
          ],
        },
        {
          heading: "Responsabilidad sobre el contenido",
          paragraphs: [
            "El usuario es responsable de las publicaciones realizadas desde su Página y debe cumplir las Condiciones y las Políticas de la Comunidad de Meta, así como las leyes aplicables. El contenido generado automáticamente debe ser revisado antes de publicarse cuando así esté configurado.",
          ],
        },
        {
          heading: "Conexión con Meta",
          paragraphs: [
            "El usuario puede revocar el acceso en cualquier momento desde la configuración de su cuenta de Facebook (Configuración › Integraciones comerciales) o desconectando la Página en la plataforma.",
          ],
        },
        {
          heading: "Disponibilidad y límites",
          paragraphs: [
            "El servicio se ofrece \"tal cual\", sin garantía de disponibilidad continua. Podemos suspenderlo ante un uso abusivo o ante cambios en las plataformas de terceros de las que depende. No somos responsables por interrupciones o cambios de Meta.",
          ],
        },
        {
          heading: "Cambios",
          paragraphs: ["Podemos actualizar estas condiciones; la fecha de arriba indica la última versión."],
        },
        contact,
      ],
    };
  }

  return {
    title: `Eliminación de datos de usuario de ${pageName}`,
    intro: `${upd} Así podés pedir que eliminemos la información asociada a ${pageName} en la plataforma Facebook Factory.`,
    sections: [
      {
        heading: "Opción 1: quitar la app desde Facebook",
        list: [
          "Entrá a Facebook › Configuración y privacidad › Configuración › Integraciones comerciales.",
          "Buscá la aplicación y elegí «Quitar».",
          "Marcá la opción para eliminar las publicaciones o datos, si querés.",
        ],
        paragraphs: ["Al quitar la app, el token de acceso deja de ser válido y no podemos seguir accediendo a la Página."],
      },
      {
        heading: "Opción 2: pedirlo por correo",
        paragraphs: [
          `Escribí a ${contactEmail} con el asunto «Eliminar mis datos» e indicá el nombre de la Página. Borramos el token de acceso y los datos asociados en un plazo máximo de 30 días y te confirmamos por el mismo medio.`,
        ],
      },
      {
        heading: "Qué se elimina",
        list: [
          "El token de acceso de la Página y los datos de conexión.",
          "Los contenidos programados y sus métricas asociadas a la Página.",
        ],
        paragraphs: ["Las publicaciones ya hechas en Facebook permanecen en tu Página: eliminalas desde Facebook si querés borrarlas allí."],
      },
      contact,
    ],
  };
}
