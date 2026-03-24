import 'dotenv/config';
import { google } from 'googleapis';
import { readFile } from 'fs/promises';
import path from 'path';

async function main() {
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
  const tokenFile = path.resolve(process.cwd(), '.google-oauth.json');
  
  try {
    const content = await readFile(tokenFile, 'utf8');
    const credentials = JSON.parse(content);
    
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    auth.setCredentials(credentials);
    
    const sheets = google.sheets({ version: 'v4', auth });
    
    // 1. Create the sheet
    console.log('Creating MAINTENANCE sheet...');
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: 'MAINTENANCE'
              }
            }
          }
        ]
      }
    });

    // 2. Add headers
    console.log('Adding headers...');
    const headers = [
      'TICKET ID',
      'RESIDENT EMAIL',
      'RESIDENT NAME',
      'BRANCH',
      'LOCATION',
      'DEVICE',
      'ISSUE DESCRIPTION',
      'REPORTED AT',
      'STATUS',
      'MECHANIC EMAIL',
      'SOLVED AT',
      'REPAIR TIME MINUTES',
      'RESIDENT SATISFACTION',
      'RESIDENT FEEDBACK'
    ];

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'MAINTENANCE!A1:N1',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [headers]
      }
    });

    console.log('Successfully created MAINTENANCE tab with headers.');
  } catch (error: any) {
    if (error.response?.data?.error?.message?.includes('already exists')) {
        console.log('MAINTENANCE sheet already exists. Just adding headers if missing...');
        // (Implementation for adding headers to existing sheet could go here if needed)
    } else {
        console.error('Error:', error.response?.data || error.message);
    }
  }
}

main();
