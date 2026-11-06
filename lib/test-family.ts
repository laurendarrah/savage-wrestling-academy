// Reserved IDs distinguish sample records from academy records.
export const testWaiverTemplateId='swa-test-waiver';
export const testFamilyParentName='Jordan Demo';
export const testWrestlerPrefix='swa-test-';
export const isTestWrestler=(id:string)=>id.startsWith(testWrestlerPrefix);
export const testWrestlers=[
 {id:'swa-test-development',name:'Sam Demo',grade:'5',program:'Elementary'},
 {id:'swa-test-intermediate',name:'Morgan Demo',grade:'8',program:'Intermediate'},
 {id:'swa-test-advance',name:'Alex Demo',grade:'10',program:'Advanced'}
] as const;

export const sampleFamilies=[
 {slug:'development',parentName:'Casey Demo',email:'casey@example.test',wrestler:{...testWrestlers[0],birthDate:'2016-03-10',allergies:'Peanuts (sample)'}},
 {slug:'intermediate',parentName:'Taylor Demo',email:'taylor@example.test',wrestler:{...testWrestlers[1],birthDate:'2013-04-18'}},
 {slug:'advance',parentName:'Riley Demo',email:'riley@example.test',wrestler:{...testWrestlers[2],birthDate:'2011-06-22'}}
] as const;
