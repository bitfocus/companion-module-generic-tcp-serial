## Generic TCP Serial Module
A generic module to forward a TCP connection to an attached serial/comm/rs232 port

This is a Serial (RS232) to TCP bridge for Companion. By itself is not very useful. 

Most Companion modules use TCP networking to control devices. This module creates a TCP server connected to a serial port on the Companion computer.

This module allows 4 incoming TCP connections. It may be possible to confuse the device if more than one client sends a command at the same time.

### Traffic Flow
* Data coming from a TCP client is sent as-is _ONLY_ to the serial port. This prevents other clients from seeing commands that may not correspond to device feedback notifications.
* Data coming from the serial port is sent as-is to _ALL_ connected TCP clients. This allows all clients to adjust feedback/variables if necessary.


## Configuration
Setting | Description
-----------------|---------------
**Listen Port** | Enter the IP Port number to listen for a TCP connection. Defaults to 32100 and will need to be changed if more than one serial port is to be configured.
**Serial Port** | Choose the Serial port attached to the device
**Baud Rate** | Choose the baud rate for the serial port
**Data Bits** | Choose the data bits for the serial port
**Parity** | Choose the parity for the serial port
**Stop Bits** | Choose the stop bits for the serial port

## Variables
Variable | Description
-----|-----
ip_add | Address of the clients connected to the TCP server

This is a helper to assist other modules. There are no actions.
