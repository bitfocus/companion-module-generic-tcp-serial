// serial port configuration choices
export const BAUD_RATES =
[9600, 14400, 19200, 38400, 57600, 115200, 110, 300, 1200, 2400, 4800].map( (v) => {
	return { id: v, label: v + ' Baud'};
});

export const BITS =
[8,7,6,5].map ( (v) => {
	return { id: v, label: v + ' Bits'};
});

export const PARITY =
['None','Even','Odd','Mark','Space'].map( (v) => {
	return { id: v.toLowerCase(), label: v};
});

export const STOP =
[1, 2].map ( (v) => {
	return { id: v, label: v + ' Bits'};
});
