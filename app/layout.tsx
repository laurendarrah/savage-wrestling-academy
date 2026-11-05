import type { Metadata } from "next";
export const metadata: Metadata = {title:"Savage | Owner Workspace",description:"Savage Wrestling Academy owner workspace"};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="en"><body>{children}</body></html>}
